//! Heuristic polishing for dictated English: capitalization, whitespace, light terminal punctuation.

#[tauri::command]
pub fn polish_final_transcript(text: String) -> Result<String, String> {
    let t = text.trim();
    if t.is_empty() {
        return Ok(String::new());
    }
    Ok(heuristic_polish_en(t))
}

/// Capitalise phrase starts after `.!?` boundaries; normalise whitespace; light terminal punctuation.
pub fn heuristic_polish_en(input: &str) -> String {
    let condensed = normalize_ws(input);
    if condensed.is_empty() {
        return String::new();
    }

    let mut out = String::with_capacity(condensed.len() + 1);
    let mut cap_next = true;

    for ch in condensed.trim().chars() {
        if cap_next {
            if ch.is_whitespace() {
                out.push(ch);
                continue;
            }
            if ch.is_alphabetic() {
                for u in ch.to_uppercase() {
                    out.push(u);
                }
                cap_next = false;
            } else {
                out.push(ch);
                if !(ch.is_ascii_digit() || ch == '"' || ch == '\'' || ch == '(') {
                    cap_next = false;
                }
            }
        } else {
            out.push(ch);
            if matches!(ch, '.' | '!' | '?') {
                cap_next = true;
            }
        }
    }

    let trimmed = normalize_ws(out.trim());
    append_terminal_if_needed(trimmed)
}

fn normalize_ws(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn append_terminal_if_needed(s: String) -> String {
    let t = s.trim_end();
    if t.is_empty() {
        return String::new();
    }
    if t.ends_with('.') || t.ends_with('!') || t.ends_with('?') {
        return t.to_string();
    }
    if let Some(ch) = t.chars().rev().find(|c| !c.is_whitespace()) {
        if ch.is_alphanumeric() || ch == '\'' || ch == '\u{2019}' || ch == '"' || ch == '\u{201d}' {
            let mut out = t.to_string();
            if !out.ends_with('.') && !out.ends_with('!') && !out.ends_with('?') {
                out.push('.');
            }
            return out;
        }
    }
    t.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heuristic_polish_empty_and_whitespace() {
        assert_eq!(heuristic_polish_en(""), "");
        assert_eq!(heuristic_polish_en("   \n\t  "), "");
    }

    #[test]
    fn heuristic_polish_sentence_cap_and_period() {
        let out = heuristic_polish_en("hello world");
        assert!(out.starts_with("Hello"));
        assert!(out.ends_with('.'));
    }

    #[test]
    fn heuristic_polish_respects_sentence_boundaries() {
        let out = heuristic_polish_en("first. second phrase");
        assert!(out.contains("First."));
        assert!(out.contains("Second"));
    }

    #[test]
    fn polish_command_empty() {
        assert_eq!(polish_final_transcript("".into()).unwrap(), "");
        assert_eq!(polish_final_transcript("  \n  ".into()).unwrap(), "");
    }
}
