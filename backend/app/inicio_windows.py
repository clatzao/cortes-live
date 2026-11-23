"""Iniciar com o Windows (Ajustes): um valor na chave Run do registro que abre o programa na bandeja."""
import os
import winreg

_CHAVE = r"Software\Microsoft\Windows\CurrentVersion\Run"
_NOME = "Cortes Live"


def _exe() -> str:
    """O executável do programa instalado (o app de desktop passa CORTES_EXE ao ligar o motor)."""
    return os.environ.get("CORTES_EXE", "")


def disponivel() -> bool:
    return os.name == "nt" and _exe().lower().endswith(".exe")


def aplicar(ligar: bool) -> None:
    if not disponivel():
        if ligar:
            raise ValueError("Iniciar com o Windows só funciona no programa instalado.")
        return
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _CHAVE, 0, winreg.KEY_SET_VALUE) as chave:
        if ligar:
            winreg.SetValueEx(chave, _NOME, 0, winreg.REG_SZ, f'"{_exe()}" --bandeja')
        else:
            try:
                winreg.DeleteValue(chave, _NOME)
            except FileNotFoundError:
                pass


def ligado() -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _CHAVE) as chave:
            return bool(winreg.QueryValueEx(chave, _NOME)[0])
    except OSError:
        return False
