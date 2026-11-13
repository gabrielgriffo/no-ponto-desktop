use chrono::{Duration, NaiveDate, NaiveDateTime, Timelike};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};

pub const TICK_SECS: u64 = 60;
pub const JITTER_SECS: i64 = 60;

const BLIND_MIN_MINUTES: i64 = 5;
const BLIND_STEP_MINUTES: i64 = 2;
const BLIND_MAX_MINUTES: i64 = 15;
const ACTIVE_MINUTES: i64 = 30;
const ERROR_RETRY_MINUTES: i64 = 5;
const WINDOW_START: u32 = 7 * 60;
const WINDOW_END: u32 = 10 * 60;
const SUSPEND_GAP_SECS: i64 = 3 * TICK_SECS as i64;

#[derive(Default)]
pub struct SmartSyncSignal(AtomicBool);

impl SmartSyncSignal {
    pub fn request_reset(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub fn take_reset(&self) -> bool {
        self.0.swap(false, Ordering::Relaxed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Blind,
    Active,
    Ended,
}

pub fn phase_of(work_day: &Value, expected_minutes: u32) -> Phase {
    let cards = crate::workday::valid_cards(work_day);
    if !crate::workday::is_started(&cards) {
        Phase::Blind
    } else if crate::workday::is_ended(&cards, expected_minutes) {
        Phase::Ended
    } else {
        Phase::Active
    }
}

fn in_probable_window(now: NaiveDateTime) -> bool {
    let minutes = now.hour() * 60 + now.minute();
    (WINDOW_START..WINDOW_END).contains(&minutes)
}

pub struct Schedule {
    phase: Phase,
    blind_minutes: i64,
    next: Option<NaiveDateTime>,
    last_fetch: Option<NaiveDateTime>,
    last_tick: Option<NaiveDateTime>,
    ended_on: Option<NaiveDate>,
    was_in_window: bool,
}

impl Schedule {
    pub fn new() -> Self {
        Self {
            phase: Phase::Blind,
            blind_minutes: BLIND_MIN_MINUTES,
            next: None,
            last_fetch: None,
            last_tick: None,
            ended_on: None,
            was_in_window: false,
        }
    }

    pub fn reset_backoff(&mut self) {
        if self.phase != Phase::Blind {
            return;
        }
        self.blind_minutes = BLIND_MIN_MINUTES;
        if let Some(last_fetch) = self.last_fetch {
            let earliest = last_fetch + Duration::minutes(BLIND_MIN_MINUTES);
            self.next = Some(self.next.map_or(earliest, |next| next.min(earliest)));
        }
    }

    pub fn is_due(&mut self, now: NaiveDateTime) -> bool {
        let resumed = self
            .last_tick
            .is_some_and(|last| (now - last).num_seconds() > SUSPEND_GAP_SECS);
        self.last_tick = Some(now);

        let in_window = in_probable_window(now);
        let entered_window = in_window && !self.was_in_window;
        self.was_in_window = in_window;

        if let Some(ended_on) = self.ended_on {
            if ended_on == now.date() {
                return false;
            }
            self.ended_on = None;
            self.phase = Phase::Blind;
            self.blind_minutes = BLIND_MIN_MINUTES;
            self.next = None;
        }

        if resumed || entered_window {
            self.reset_backoff();
        }

        self.next.is_none_or(|next| now >= next)
    }

    pub fn on_success(&mut self, now: NaiveDateTime, phase: Phase, jitter_secs: i64) {
        self.phase = phase;
        self.last_fetch = Some(now);
        let jitter = Duration::seconds(jitter_secs);

        match phase {
            Phase::Blind => {
                let interval = if in_probable_window(now) {
                    BLIND_MIN_MINUTES
                } else {
                    let current = self.blind_minutes;
                    self.blind_minutes = (current + BLIND_STEP_MINUTES).min(BLIND_MAX_MINUTES);
                    current
                };
                self.next = Some(now + Duration::minutes(interval) + jitter);
            }
            Phase::Active => {
                self.blind_minutes = BLIND_MIN_MINUTES;
                self.next = Some(now + Duration::minutes(ACTIVE_MINUTES) + jitter);
            }
            Phase::Ended => {
                self.ended_on = Some(now.date());
                self.next = None;
            }
        }
    }

    pub fn on_error(&mut self, now: NaiveDateTime, jitter_secs: i64) {
        self.next = Some(now + Duration::minutes(ERROR_RETRY_MINUTES) + Duration::seconds(jitter_secs));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn at(hour: u32, minute: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 11, 13)
            .unwrap()
            .and_hms_opt(hour, minute, 0)
            .unwrap()
    }

    fn next_day(hour: u32, minute: u32) -> NaiveDateTime {
        at(hour, minute) + Duration::days(1)
    }

    fn intervals_after_empty_fetches(start: NaiveDateTime, count: usize) -> Vec<i64> {
        let mut schedule = Schedule::new();
        let mut now = start;
        let mut out = Vec::new();
        for _ in 0..count {
            while !schedule.is_due(now) {
                now += Duration::seconds(TICK_SECS as i64);
            }
            schedule.on_success(now, Phase::Blind, 0);
            out.push((schedule.next.unwrap() - now).num_minutes());
        }
        out
    }

    #[test]
    fn first_tick_fetches_right_away() {
        assert!(Schedule::new().is_due(at(12, 0)));
    }

    #[test]
    fn empty_fetches_back_off_up_to_the_ceiling() {
        assert_eq!(intervals_after_empty_fetches(at(12, 0), 7), [5, 7, 9, 11, 13, 15, 15]);
    }

    #[test]
    fn the_probable_window_keeps_the_short_interval() {
        assert_eq!(intervals_after_empty_fetches(at(7, 0), 4), [5, 5, 5, 5]);
    }

    #[test]
    fn entering_the_window_resets_the_backoff() {
        let mut schedule = Schedule::new();
        let mut now = at(5, 0);
        for _ in 0..6 {
            schedule.is_due(now);
            schedule.on_success(now, Phase::Blind, 0);
            now += Duration::minutes(1);
        }
        let mut tick = at(6, 59);
        while tick < at(7, 1) {
            schedule.is_due(tick);
            tick += Duration::minutes(1);
        }
        assert_eq!(schedule.blind_minutes, BLIND_MIN_MINUTES);
    }

    #[test]
    fn a_shown_window_brings_the_next_fetch_closer() {
        let mut schedule = Schedule::new();
        let now = at(14, 0);
        for minutes in [0, 1, 2, 3] {
            schedule.on_success(now + Duration::minutes(minutes), Phase::Blind, 0);
        }
        let last = now + Duration::minutes(3);
        assert_eq!(schedule.next, Some(last + Duration::minutes(11)));
        schedule.reset_backoff();
        assert_eq!(schedule.next, Some(last + Duration::minutes(5)));
        assert_eq!(schedule.blind_minutes, BLIND_MIN_MINUTES);
    }

    #[test]
    fn resuming_from_suspension_resets_the_backoff() {
        let mut schedule = Schedule::new();
        let now = at(14, 0);
        for minutes in [0, 1, 2, 3] {
            schedule.is_due(now + Duration::minutes(minutes));
            schedule.on_success(now + Duration::minutes(minutes), Phase::Blind, 0);
        }
        assert!(schedule.is_due(now + Duration::minutes(40)));
        assert_eq!(schedule.blind_minutes, BLIND_MIN_MINUTES);
    }

    #[test]
    fn an_open_workday_uses_the_long_interval() {
        let mut schedule = Schedule::new();
        schedule.on_success(at(9, 0), Phase::Active, 30);
        assert_eq!(schedule.next, Some(at(9, 30) + Duration::seconds(30)));
        assert!(!schedule.is_due(at(9, 20)));
        assert!(schedule.is_due(at(9, 31)));
    }

    #[test]
    fn an_ended_workday_stops_until_the_next_day() {
        let mut schedule = Schedule::new();
        schedule.on_success(at(18, 0), Phase::Ended, 0);
        assert!(!schedule.is_due(at(18, 1)));
        assert!(!schedule.is_due(at(23, 59)));
        assert!(schedule.is_due(next_day(0, 0)));
        assert_eq!(schedule.phase, Phase::Blind);
    }

    #[test]
    fn errors_retry_without_growing_the_backoff() {
        let mut schedule = Schedule::new();
        schedule.on_success(at(12, 0), Phase::Blind, 0);
        schedule.on_error(at(12, 5), 0);
        assert_eq!(schedule.next, Some(at(12, 10)));
        assert_eq!(schedule.blind_minutes, BLIND_MIN_MINUTES + BLIND_STEP_MINUTES);
    }

    #[test]
    fn phase_follows_the_workday_cards() {
        let day = |times: &[&str]| {
            let cards: Vec<Value> = times.iter().map(|time| json!({ "time": time })).collect();
            json!({ "work_days": [{ "time_cards": cards }] })
        };
        assert_eq!(phase_of(&day(&[]), 480), Phase::Blind);
        assert_eq!(phase_of(&day(&["08:00"]), 480), Phase::Active);
        assert_eq!(phase_of(&day(&["08:00", "12:00", "13:00", "17:00"]), 480), Phase::Ended);
    }

    #[test]
    fn the_reset_signal_is_consumed_once() {
        let signal = SmartSyncSignal::default();
        assert!(!signal.take_reset());
        signal.request_reset();
        assert!(signal.take_reset());
        assert!(!signal.take_reset());
    }
}
