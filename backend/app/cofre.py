"""Cofre dos tokens das redes: um arquivo por conta em dados/cofre, cifrado com a DPAPI do Windows.

Só o seu usuário do Windows, neste PC, consegue abrir. Os tokens nunca vão para o banco nem para o site.
"""
import base64
import ctypes
import json
import os
from ctypes import wintypes

from . import config

PASTA = config.DADOS / "cofre"
_ENTROPIA = b"cortes-live/redes"


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(dados: bytes) -> _Blob:
    buf = ctypes.create_string_buffer(dados, len(dados))
    return _Blob(len(dados), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _dpapi(dados: bytes, cifrar: bool) -> bytes:
    if os.name != "nt":  # fora do Windows (só testes): sem cifra
        return dados
    entrada, entropia, saida = _blob(dados), _blob(_ENTROPIA), _Blob()
    funcao = ctypes.windll.crypt32.CryptProtectData if cifrar else ctypes.windll.crypt32.CryptUnprotectData
    ok = funcao(ctypes.byref(entrada), None if not cifrar else "Cortes Live", ctypes.byref(entropia), None, None,
                0x01, ctypes.byref(saida))  # 0x01 = CRYPTPROTECT_UI_FORBIDDEN
    if not ok:
        raise OSError("O Windows não conseguiu abrir o cofre das contas (outro usuário ou outro PC?).")
    try:
        return ctypes.string_at(saida.pbData, saida.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(saida.pbData)


def _arquivo(conta_id: int):
    return PASTA / f"conta_{int(conta_id)}.bin"


def guardar(conta_id: int, tokens: dict) -> None:
    PASTA.mkdir(parents=True, exist_ok=True)
    cifrado = _dpapi(json.dumps(tokens).encode("utf-8"), cifrar=True)
    temp = _arquivo(conta_id).with_suffix(".tmp")
    temp.write_bytes(base64.b64encode(cifrado))
    os.replace(temp, _arquivo(conta_id))


def ler(conta_id: int) -> dict | None:
    try:
        cifrado = base64.b64decode(_arquivo(conta_id).read_bytes())
    except OSError:
        return None
    try:
        return json.loads(_dpapi(cifrado, cifrar=False).decode("utf-8"))
    except (OSError, ValueError):
        return None


def apagar(conta_id: int) -> None:
    try:
        _arquivo(conta_id).unlink()
    except FileNotFoundError:
        pass
