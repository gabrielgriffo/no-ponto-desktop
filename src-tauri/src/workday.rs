use serde_json::Value;

/// Cards `disabled` são batidas revogadas pelo próprio PontoMais — ficam de fora
/// de tudo, inclusive da paridade.
pub fn valid_cards(work_day: &Value) -> Vec<&Value> {
    work_day
        .get("work_days")
        .and_then(|days| days.get(0))
        .and_then(|day| day.get("time_cards"))
        .and_then(|cards| cards.as_array())
        .map(|cards| {
            cards
                .iter()
                .filter(|card| {
                    !card
                        .get("disabled")
                        .and_then(|disabled| disabled.as_bool())
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn card_minutes(card: &Value) -> Option<u32> {
    let time = card.get("time")?.as_str()?;
    let (hours, minutes) = time.trim().split_once(':')?;

    let hours: u32 = hours.parse().ok()?;
    let minutes: u32 = minutes.parse().ok()?;

    if hours > 23 || minutes > 59 {
        return None;
    }

    Some(hours * 60 + minutes)
}

/// `None` em horário impossível: sem saber as horas, o dia não é dado como
/// encerrado, e o pior caso vira um lançamento extra.
pub fn worked_minutes(cards: &[&Value]) -> Option<u32> {
    let mut times = Vec::with_capacity(cards.len());
    for card in cards {
        times.push(card_minutes(card)?);
    }
    times.sort_unstable();

    Some(times.chunks_exact(2).map(|pair| pair[1] - pair[0]).sum())
}

pub fn is_started(cards: &[&Value]) -> bool {
    !cards.is_empty()
}

/// Contagem ímpar significa par aberto: o usuário está dentro do expediente
/// agora, e nada mais precisa ser consultado.
pub fn is_ended(cards: &[&Value], expected_minutes: u32) -> bool {
    if cards.is_empty() || cards.len() % 2 != 0 {
        return false;
    }

    matches!(worked_minutes(cards), Some(worked) if worked >= expected_minutes)
}

pub fn should_launch(work_day: &Value, expected_minutes: u32) -> bool {
    let cards = valid_cards(work_day);

    is_started(&cards) && !is_ended(&cards, expected_minutes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const EIGHT_HOURS: u32 = 480;

    fn work_day(times: &[(&str, bool)]) -> Value {
        let cards: Vec<Value> = times
            .iter()
            .map(|(time, disabled)| json!({ "time": time, "disabled": disabled }))
            .collect();

        json!({ "work_days": [{ "time_cards": cards }] })
    }

    fn enabled(times: &[&str]) -> Value {
        let cards: Vec<(&str, bool)> = times.iter().map(|time| (*time, false)).collect();
        work_day(&cards)
    }

    #[test]
    fn no_cards_means_not_started() {
        let day = enabled(&[]);
        assert!(!should_launch(&day, EIGHT_HOURS));
        assert!(!is_started(&valid_cards(&day)));
    }

    #[test]
    fn missing_payload_means_not_started() {
        assert!(!should_launch(&json!({}), EIGHT_HOURS));
        assert!(!should_launch(&json!({ "work_days": [] }), EIGHT_HOURS));
    }

    #[test]
    fn odd_count_is_never_ended() {
        for times in [
            vec!["08:00"],
            vec!["08:00", "12:00", "13:00"],
            vec!["08:00", "12:00", "13:00", "18:00", "19:00"],
        ] {
            let day = enabled(&times);
            let cards = valid_cards(&day);

            assert!(!is_ended(&cards, EIGHT_HOURS), "{:?}", times);
            assert!(should_launch(&day, EIGHT_HOURS), "{:?}", times);
        }
    }

    #[test]
    fn five_cards_past_the_workday_still_launches() {
        let day = enabled(&["08:00", "12:00", "13:00", "18:00", "19:00"]);
        let cards = valid_cards(&day);

        assert_eq!(worked_minutes(&cards[..4]), Some(540));
        assert!(should_launch(&day, EIGHT_HOURS));
    }

    #[test]
    fn even_count_below_the_workday_is_not_ended() {
        let day = enabled(&["08:00", "12:00", "13:00", "16:00"]);
        let cards = valid_cards(&day);

        assert_eq!(worked_minutes(&cards), Some(420));
        assert!(!is_ended(&cards, EIGHT_HOURS));
        assert!(should_launch(&day, EIGHT_HOURS));
    }

    #[test]
    fn even_count_reaching_the_workday_is_ended() {
        let day = enabled(&["08:00", "12:00", "13:00", "17:00"]);
        let cards = valid_cards(&day);

        assert_eq!(worked_minutes(&cards), Some(480));
        assert!(is_ended(&cards, EIGHT_HOURS));
        assert!(!should_launch(&day, EIGHT_HOURS));
    }

    #[test]
    fn straight_shift_without_lunch_is_ended() {
        let day = enabled(&["08:00", "16:00"]);
        assert!(!should_launch(&day, EIGHT_HOURS));
    }

    #[test]
    fn six_cards_reaching_the_workday_are_ended() {
        let day = enabled(&["08:00", "10:00", "10:15", "12:00", "13:00", "18:00"]);
        let cards = valid_cards(&day);

        assert_eq!(worked_minutes(&cards), Some(525));
        assert!(is_ended(&cards, EIGHT_HOURS));
    }

    #[test]
    fn six_cards_below_the_workday_still_launch() {
        let day = enabled(&["08:00", "10:00", "10:15", "12:00", "13:00", "15:00"]);
        assert!(should_launch(&day, EIGHT_HOURS));
    }

    #[test]
    fn shorter_workday_ends_earlier() {
        let day = enabled(&["08:00", "14:00"]);
        let cards = valid_cards(&day);

        assert!(is_ended(&cards, 360));
        assert!(!is_ended(&cards, EIGHT_HOURS));
    }

    #[test]
    fn disabled_cards_are_ignored() {
        let day = work_day(&[
            ("08:00", false),
            ("09:00", true),
            ("12:00", false),
            ("13:00", false),
            ("17:00", false),
        ]);
        let cards = valid_cards(&day);

        assert_eq!(cards.len(), 4);
        assert_eq!(worked_minutes(&cards), Some(480));
        assert!(is_ended(&cards, EIGHT_HOURS));
        assert!(!should_launch(&day, EIGHT_HOURS));
    }

    #[test]
    fn disabled_card_does_not_flip_parity() {
        let day = work_day(&[("08:00", false), ("12:00", false), ("13:00", true)]);
        let cards = valid_cards(&day);

        assert_eq!(cards.len(), 2);
        assert!(!is_ended(&cards, EIGHT_HOURS));
    }

    #[test]
    fn unordered_cards_are_paired_by_time() {
        let day = enabled(&["13:00", "08:00", "17:00", "12:00"]);
        let cards = valid_cards(&day);

        assert_eq!(worked_minutes(&cards), Some(480));
    }

    #[test]
    fn unparsable_time_is_not_ended() {
        for time in ["", "abc", "25:00", "12:61", "1200"] {
            let day = enabled(&["08:00", "12:00", "13:00", time]);
            let cards = valid_cards(&day);

            assert_eq!(worked_minutes(&cards), None, "{}", time);
            assert!(!is_ended(&cards, EIGHT_HOURS), "{}", time);
            assert!(should_launch(&day, EIGHT_HOURS), "{}", time);
        }
    }
}
