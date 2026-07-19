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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_report])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
