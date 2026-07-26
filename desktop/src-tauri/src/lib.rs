// SafeShip 오버레이 — 프론트가 실제 스캔 리포트를 런타임에 받도록 read_report 커맨드 제공.
// 훅/CLI가 SAFESHIP_PAYLOAD 환경변수에 payload({report, celebrate}) JSON 파일 경로를 넣어 앱을 실행한다.

#[tauri::command]
fn read_report() -> String {
    match std::env::var("SAFESHIP_PAYLOAD") {
        Ok(path) if !path.is_empty() => {
            std::fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string())
        }
        _ => "{}".to_string(),
    }
}

/// 홈 폴더의 ~/.safeship.json 경로. (CLI가 기본 UI 모드를 읽는 곳과 같은 파일)
fn config_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    Some(std::path::Path::new(&home).join(".safeship.json"))
}

/// 앱 안에서 고른 표시 방식("full" | "mini")을 저장한다. 다음 push부터 CLI가 이 값을 읽는다.
/// 기존 설정의 다른 키는 보존하고 ui만 바꾼다.
#[tauri::command]
fn save_ui_mode(mode: String) -> Result<String, String> {
    if mode != "full" && mode != "mini" {
        return Err(format!("알 수 없는 표시 방식: {mode}"));
    }
    let path = config_path().ok_or("홈 폴더를 찾지 못했어요")?;
    let mut cfg = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    cfg.insert("ui".into(), serde_json::Value::String(mode));
    let body = serde_json::to_string_pretty(&serde_json::Value::Object(cfg))
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_report, save_ui_mode])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
