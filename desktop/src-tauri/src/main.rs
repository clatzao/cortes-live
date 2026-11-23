// Cortes Live (desktop): janela própria que prepara e liga o motor (Python) e fecha tudo ao sair.
//
// Na primeira vez: baixa o FFmpeg (se o PC não tiver) e instala o Python + bibliotecas com o uv.
// Depois: sobe o servidor local numa porta livre e abre o site dentro da janela.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, State, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const SEM_JANELA: u32 = 0x0800_0000; // CREATE_NO_WINDOW
const URL_FFMPEG: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

#[derive(Clone, Serialize, Default)]
struct Estado {
    etapa: String,
    detalhe: String,
    erro: Option<String>,
    url: Option<String>,
}

#[derive(Default)]
struct Motor {
    estado: Mutex<Estado>,
    processo: Mutex<Option<Child>>,
    rodando: Mutex<bool>,
}

type Compartilhado = Arc<Motor>;

struct Pastas {
    motor: PathBuf, // arquivos do programa (backend, site, fontes, uv.exe)
    base: PathBuf,  // dados do usuário: %LOCALAPPDATA%\br.cortes.live
}

impl Pastas {
    fn venv(&self) -> PathBuf {
        self.base.join("python")
    }
    fn ferramentas(&self) -> PathBuf {
        self.base.join("ferramentas")
    }
    fn registro(&self) -> PathBuf {
        self.base.join("motor.log")
    }
}

fn pastas(app: &tauri::AppHandle) -> Result<Pastas, String> {
    let motor = app.path().resource_dir().map_err(|e| e.to_string())?.join("motor");
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&base).map_err(|e| format!("Não foi possível criar {}: {e}", base.display()))?;
    Ok(Pastas { motor, base })
}

fn definir(m: &Motor, etapa: &str, detalhe: &str) {
    let mut e = m.estado.lock().unwrap();
    e.etapa = etapa.into();
    e.detalhe = detalhe.into();
}

fn comando(exe: impl AsRef<OsStr>) -> Command {
    let mut c = Command::new(exe);
    #[cfg(windows)]
    c.creation_flags(SEM_JANELA);
    c
}

fn sistema(nome: &str) -> PathBuf {
    let raiz = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    raiz.join("System32").join(nome)
}

// ------------------------------------------------------------------ comandos da tela de abertura

#[tauri::command]
fn estado(m: State<Compartilhado>) -> Estado {
    m.estado.lock().unwrap().clone()
}

#[tauri::command]
fn tentar_de_novo(app: tauri::AppHandle, m: State<Compartilhado>) {
    iniciar(app, m.inner().clone());
}

#[tauri::command]
fn abrir_registro(app: tauri::AppHandle) {
    if let Ok(p) = pastas(&app) {
        let _ = Command::new(sistema("notepad.exe")).arg(p.registro()).spawn();
    }
}

// ------------------------------------------------------------------ preparação

fn iniciar(app: tauri::AppHandle, m: Compartilhado) {
    {
        let mut r = m.rodando.lock().unwrap();
        if *r {
            return;
        }
        *r = true;
    }
    *m.estado.lock().unwrap() = Estado { etapa: "Abrindo".into(), ..Default::default() };
    thread::spawn(move || {
        if let Err(e) = preparar_e_ligar(&app, &m) {
            m.estado.lock().unwrap().erro = Some(e);
        }
        *m.rodando.lock().unwrap() = false;
    });
}

fn preparar_e_ligar(app: &tauri::AppHandle, m: &Motor) -> Result<(), String> {
    let p = pastas(app)?;
    if !p.motor.join("backend").join("app").join("main.py").exists() {
        return Err(format!("Arquivos do programa não encontrados em {}. Reinstale o Cortes Live.", p.motor.display()));
    }

    // 0) Versão nova no GitHub? Baixa, instala e reabre sozinho (sem internet, só segue).
    atualizar(app, m, &p);

    // 1) FFmpeg
    if !tem_ffmpeg(&p.ferramentas()) {
        baixar_ffmpeg(m, &p.ferramentas())?;
    }

    // 2) Python e bibliotecas (rápido quando já estão instalados)
    instalar_bibliotecas(m, &p)?;

    // 3) Motor
    definir(m, "Ligando o motor", "");
    let porta = porta_livre();
    let mut log = File::create(p.registro()).map_err(|e| e.to_string())?;
    let _ = writeln!(log, "Cortes Live {} — porta {porta}", app.package_info().version);
    let py = p.venv().join("Scripts").join("python.exe");
    let filho = comando(&py)
        .args(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", &porta.to_string()])
        .current_dir(p.motor.join("backend"))
        .env("CORTES_DADOS", p.base.join("dados"))
        .env("CORTES_FERRAMENTAS", p.ferramentas())
        .env("CORTES_PORTA", porta.to_string())
        // o motor grava "iniciar com o Windows" (Ajustes) apontando para este executável
        .env("CORTES_EXE", std::env::current_exe().unwrap_or_default())
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .spawn()
        .map_err(|e| format!("Não foi possível ligar o motor: {e}"))?;
    #[cfg(windows)]
    prender_no_job(&filho);
    *m.processo.lock().unwrap() = Some(filho);

    // 4) Espera o servidor responder
    let inicio = Instant::now();
    let endereco = SocketAddr::from(([127, 0, 0, 1], porta));
    loop {
        if let Some(c) = m.processo.lock().unwrap().as_mut() {
            if let Ok(Some(st)) = c.try_wait() {
                return Err(format!("O motor fechou ao iniciar ({st}).\n\n{}", final_do_registro(&p.registro())));
            }
        }
        if TcpStream::connect_timeout(&endereco, Duration::from_millis(300)).is_ok() {
            break;
        }
        if inicio.elapsed() > Duration::from_secs(180) {
            return Err(format!("O motor demorou demais para responder.\n\n{}", final_do_registro(&p.registro())));
        }
        definir(m, "Ligando o motor", &format!("{} s", inicio.elapsed().as_secs()));
        thread::sleep(Duration::from_millis(400));
    }
    m.estado.lock().unwrap().url = Some(format!("http://127.0.0.1:{porta}/"));

    // 5) Bibliotecas CUDA 12 (placa NVIDIA): baixam em segundo plano, sem travar a abertura.
    //    Se o download falhar, a transcrição usa o processador e tenta de novo na próxima abertura.
    if sistema("nvidia-smi.exe").exists() && !tem_cuda(&p) {
        thread::spawn(move || baixar_cuda(&p));
    }
    Ok(())
}

fn tem_cuda(p: &Pastas) -> bool {
    let nv = p.venv().join("Lib").join("site-packages").join("nvidia");
    nv.join("cublas").join("bin").exists() && nv.join("cudnn").join("bin").exists()
}

fn baixar_cuda(p: &Pastas) {
    let mut log = match File::create(p.base.join("cuda.log")) {
        Ok(f) => f,
        Err(_) => return,
    };
    for tentativa in 1..=3 {
        let _ = writeln!(log, "Tentativa {tentativa} de baixar as bibliotecas CUDA 12 (~1,5 GB)");
        let saida = match log.try_clone() {
            Ok(f) => f,
            Err(_) => return,
        };
        let filho = comando(p.motor.join("uv.exe"))
            .args(["sync", "--frozen", "--inexact", "--extra", "gpu", "--project"])
            .arg(p.motor.join("backend"))
            .env("UV_PROJECT_ENVIRONMENT", p.venv())
            .env("UV_PYTHON_PREFERENCE", "only-managed")
            .env("UV_HTTP_TIMEOUT", "600") // os arquivos são grandes (até 700 MB cada)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(saida)
            .spawn();
        let mut filho = match filho {
            Ok(f) => f,
            Err(e) => {
                let _ = writeln!(log, "Não deu para rodar o uv: {e}");
                return;
            }
        };
        #[cfg(windows)]
        prender_no_job(&filho); // fecha junto com o programa
        if filho.wait().map(|s| s.success()).unwrap_or(false) && tem_cuda(p) {
            let _ = writeln!(log, "Pronto: a transcrição já pode usar a placa NVIDIA.");
            return;
        }
        thread::sleep(Duration::from_secs(30));
    }
    let _ = writeln!(log, "Não deu para baixar agora; o programa tenta de novo na próxima vez que abrir.");
}

/// Confere no GitHub se há versão nova (arquivo latest.json da última release, assinado).
/// Se houver, baixa e roda o instalador; o Windows fecha o programa e o reabre já atualizado.
/// Qualquer falha (sem internet, GitHub fora do ar) só é registrada e o programa abre normalmente.
fn atualizar(app: &tauri::AppHandle, m: &Motor, p: &Pastas) {
    let mut log = File::create(p.base.join("atualizacao.log")).ok();
    let mut anotar = |t: &str| {
        if let Some(f) = log.as_mut() {
            let _ = writeln!(f, "{t}");
        }
    };
    definir(m, "Procurando atualização", "");
    let mut construtor = app.updater_builder().timeout(Duration::from_secs(20));
    // para testes: CORTES_ATUALIZACAO_URL aponta para outro latest.json
    if let Some(url) = std::env::var("CORTES_ATUALIZACAO_URL").ok().and_then(|u| u.parse().ok()) {
        match construtor.endpoints(vec![url]) {
            Ok(c) => construtor = c,
            Err(e) => return anotar(&format!("Endereço de teste inválido: {e}")),
        }
    }
    let atualizador = match construtor.build() {
        Ok(a) => a,
        Err(e) => return anotar(&format!("Atualizador indisponível: {e}")),
    };
    let resultado = tauri::async_runtime::block_on(async {
        let Some(nova) = atualizador.check().await? else {
            return Ok(None);
        };
        let versao = nova.version.clone();
        let etapa = format!("Baixando a versão {versao}");
        definir(m, &etapa, "");
        let mut baixado = 0usize;
        nova.download_and_install(
            |pedaco, total| {
                baixado += pedaco;
                let mb = baixado as f64 / 1_048_576.0;
                let texto = match total {
                    Some(t) => format!("{mb:.1} de {:.1} MB", t as f64 / 1_048_576.0),
                    None => format!("{mb:.1} MB"),
                };
                definir(m, &etapa, &texto);
            },
            || definir(m, "Instalando a atualização", "O programa reabre sozinho em seguida."),
        )
        .await?;
        Ok::<_, tauri_plugin_updater::Error>(Some(versao))
    });
    match resultado {
        Ok(None) => anotar(&format!("Versão {} é a mais nova.", app.package_info().version)),
        Ok(Some(v)) => {
            anotar(&format!("Atualizado para {v}."));
            app.restart();
        }
        Err(e) => anotar(&format!("Não deu para atualizar agora: {e}")),
    }
}

fn tem_ffmpeg(ferr: &Path) -> bool {
    ferr.join("ffmpeg").join("bin").join("ffmpeg.exe").exists()
        || comando("ffmpeg")
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
}

fn baixar_ffmpeg(m: &Motor, ferr: &Path) -> Result<(), String> {
    fs::create_dir_all(ferr).map_err(|e| e.to_string())?;
    let zip = ferr.join("ffmpeg.zip.parcial");
    let _ = fs::remove_file(&zip);
    let mut filho = comando(sistema("curl.exe"))
        .args(["-L", "--fail", "-s", "--retry", "3", "-o"])
        .arg(&zip)
        .arg(URL_FFMPEG)
        .spawn()
        .map_err(|e| format!("Não foi possível baixar o FFmpeg: {e}"))?;
    loop {
        match filho.try_wait() {
            Ok(Some(st)) if st.success() => break,
            Ok(Some(_)) => {
                let _ = fs::remove_file(&zip);
                return Err("Não foi possível baixar o FFmpeg. Confira a internet e clique em Tentar de novo.".into());
            }
            Ok(None) => {
                let mb = fs::metadata(&zip).map(|x| x.len()).unwrap_or(0) / 1_048_576;
                definir(m, "Baixando o FFmpeg (só na primeira vez)", &format!("{mb} MB"));
                thread::sleep(Duration::from_millis(400));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    definir(m, "Extraindo o FFmpeg", "");
    let tmp = ferr.join("extraindo");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let st = comando(sistema("tar.exe")).arg("-xf").arg(&zip).arg("-C").arg(&tmp).status().map_err(|e| e.to_string())?;
    if !st.success() {
        return Err("Não foi possível extrair o FFmpeg.".into());
    }
    let dentro = fs::read_dir(&tmp)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.join("bin").join("ffmpeg.exe").exists())
        .ok_or("O FFmpeg baixado não tem o ffmpeg.exe.")?;
    let destino = ferr.join("ffmpeg");
    let _ = fs::remove_dir_all(&destino);
    fs::rename(&dentro, &destino).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&tmp);
    let _ = fs::remove_file(&zip);
    Ok(())
}

fn instalar_bibliotecas(m: &Motor, p: &Pastas) -> Result<(), String> {
    let primeira = !p.venv().join("Scripts").join("python.exe").exists();
    let etapa = if primeira {
        "Instalando o Python e as bibliotecas (só na primeira vez, pode levar alguns minutos)"
    } else {
        "Conferindo as bibliotecas"
    };
    definir(m, etapa, "");
    let mut c = comando(p.motor.join("uv.exe"));
    c.args(["sync", "--frozen", "--inexact", "--project"])
        .arg(p.motor.join("backend"))
        .env("UV_PROJECT_ENVIRONMENT", p.venv())
        .env("UV_PYTHON_PREFERENCE", "only-managed")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut filho = c.spawn().map_err(|e| format!("Não foi possível rodar o instalador de bibliotecas: {e}"))?;
    let mut ultimas = Vec::new();
    if let Some(saida) = filho.stderr.take() {
        for linha in BufReader::new(saida).lines().map_while(Result::ok) {
            let linha = linha.trim().to_string();
            if linha.is_empty() {
                continue;
            }
            definir(m, etapa, &linha);
            ultimas.push(linha);
            if ultimas.len() > 15 {
                ultimas.remove(0);
            }
        }
    }
    let st = filho.wait().map_err(|e| e.to_string())?;
    if !st.success() {
        return Err(format!(
            "A instalação das bibliotecas falhou. Confira a internet e clique em Tentar de novo.\n\n{}",
            ultimas.join("\n")
        ));
    }
    Ok(())
}

fn porta_livre() -> u16 {
    for porta in 8765..8800 {
        if TcpListener::bind(("127.0.0.1", porta)).is_ok() {
            return porta;
        }
    }
    TcpListener::bind(("127.0.0.1", 0)).and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(8765)
}

fn final_do_registro(caminho: &Path) -> String {
    let mut f = match File::open(caminho) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let tam = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(tam.saturating_sub(2000)));
    let mut s = String::new();
    let _ = f.read_to_string(&mut s);
    s
}

/// Coloca o motor num "job" do Windows: quando o programa fecha (mesmo à força), o Windows encerra
/// o motor e todos os processos dele (FFmpeg, transcrição).
#[cfg(windows)]
fn prender_no_job(filho: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        AssignProcessToJobObject(job, filho.as_raw_handle() as _);
        // o handle do job fica aberto de propósito até o programa fechar
    }
}

/// Mostra a janela (vinda da bandeja, minimizada ou atrás de outras).
fn mostrar(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Ícone na bandeja: o programa continua rodando com a janela fechada (publica no horário, grava lives).
fn criar_bandeja(app: &tauri::App) -> tauri::Result<()> {
    let abrir = MenuItem::with_id(app, "abrir", "Abrir o Cortes Live", true, None::<&str>)?;
    let sair = MenuItem::with_id(app, "sair", "Sair (para de publicar e gravar)", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &sair])?;
    let mut bandeja = TrayIconBuilder::with_id("principal")
        .tooltip("Cortes Live")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "abrir" => mostrar(app),
            "sair" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|bandeja, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                mostrar(bandeja.app_handle());
            }
        });
    if let Some(icone) = app.default_window_icon() {
        bandeja = bandeja.icon(icone.clone());
    }
    bandeja.build(app)?;
    Ok(())
}

fn main() {
    let motor: Compartilhado = Arc::new(Motor::default());
    // aberto pelo Windows ao ligar o PC (Ajustes → iniciar com o Windows): começa só na bandeja
    let na_bandeja = std::env::args().any(|a| a == "--bandeja");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // abrir de novo só traz a janela que já está aberta (ou na bandeja) para a frente
            mostrar(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(motor.clone())
        .invoke_handler(tauri::generate_handler![estado, tentar_de_novo, abrir_registro])
        .on_window_event(|janela, evento| {
            // fechar (X) só esconde: o motor segue publicando os agendados e gravando as lives
            if let WindowEvent::CloseRequested { api, .. } = evento {
                api.prevent_close();
                let _ = janela.hide();
            }
        })
        .setup(move |app| {
            criar_bandeja(app)?;
            if na_bandeja {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            let m = app.state::<Compartilhado>().inner().clone();
            iniciar(app.handle().clone(), m);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao abrir o Cortes Live");
    app.run(move |_, evento| {
        if let RunEvent::Exit = evento {
            if let Some(mut c) = motor.processo.lock().unwrap().take() {
                let _ = c.kill();
            }
        }
    });
}
