pub const AUTOSTART_ARG: &str = "--min";

#[derive(Debug, Clone, Copy)]
pub struct LaunchInfo {
    pub autostarted: bool,
}

impl LaunchInfo {
    pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Self {
        Self {
            autostarted: args.into_iter().any(|arg| arg == AUTOSTART_ARG),
        }
    }
}

pub fn start_hidden(launch: LaunchInfo, start_minimized_enabled: bool) -> bool {
    launch.autostarted || start_minimized_enabled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn autostart_is_detected_by_the_min_argument() {
        assert!(LaunchInfo::from_args(args(&["noponto.exe", "--min"])).autostarted);
        assert!(!LaunchInfo::from_args(args(&["noponto.exe"])).autostarted);
    }

    #[test]
    fn starts_hidden_when_autostarted_or_when_the_option_is_on() {
        let autostarted = LaunchInfo { autostarted: true };
        let manual = LaunchInfo { autostarted: false };
        assert!(start_hidden(autostarted, false));
        assert!(start_hidden(autostarted, true));
        assert!(start_hidden(manual, true));
        assert!(!start_hidden(manual, false));
    }
}
