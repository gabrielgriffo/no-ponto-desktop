
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn app_data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data directory: {}", e))?;

    Ok(dir.join(name))
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let json = match fs::read_to_string(path) {
        Ok(json) => json,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Failed to read {}: {}", path.display(), e)),
    };

    serde_json::from_str(&json)
        .map(Some)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

pub fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> T {
    read_json(path).ok().flatten().unwrap_or_default()
}

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(value)
        .map_err(|e| format!("Failed to serialize {}: {}", path.display(), e))?;

    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);

    let write = || -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(&json)?;
        file.sync_all()?;
        fs::rename(&tmp, path)
    };

    write().map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Failed to write {}: {}", path.display(), e)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
    struct Sample {
        value: u32,
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("noponto-storage-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_reads_as_none() {
        let dir = temp_dir("missing");
        assert_eq!(read_json::<Sample>(&dir.join("x.json")), Ok(None));
    }

    #[test]
    fn written_value_round_trips_and_leaves_no_temp_file() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("state.json");

        write_json_atomic(&path, &Sample { value: 1 }).unwrap();
        write_json_atomic(&path, &Sample { value: 2 }).unwrap();

        assert_eq!(read_json::<Sample>(&path), Ok(Some(Sample { value: 2 })));
        assert!(!dir.join("state.json.tmp").exists());
    }

    #[test]
    fn corrupt_file_is_an_error_but_falls_back_to_default() {
        let dir = temp_dir("corrupt");
        let path = dir.join("state.json");
        fs::write(&path, "{ trunc").unwrap();

        assert!(read_json::<Sample>(&path).is_err());
        assert_eq!(read_json_or_default::<Sample>(&path), Sample::default());
    }
}
