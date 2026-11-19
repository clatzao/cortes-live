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
use tauri::{Manager, RunEvent, State};

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
    Ok(())
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
    let gpu = sistema("nvidia-smi.exe").exists();
    let mut c = comando(p.motor.join("uv.exe"));
    c.args(["sync", "--frozen", "--project"])
        .arg(p.motor.join("backend"))
        .env("UV_PROJECT_ENVIRONMENT", p.venv())
        .env("UV_PYTHON_PREFERENCE", "only-managed")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if gpu {
        c.args(["--extra", "gpu"]); // bibliotecas CUDA para a transcrição na placa NVIDIA
    }
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

fn main() {
    let motor: Compartilhado = Arc::new(Motor::default());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // abrir de novo só traz a janela que já está aberta para a frente
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .manage(motor.clone())
        .invoke_handler(tauri::generate_handler![estado, tentar_de_novo, abrir_registro])
        .setup(|app| {
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
