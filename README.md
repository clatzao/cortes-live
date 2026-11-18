# Cortes Live

Site local para cortar lives com legendas e formatos pré-definidos. Roda no seu PC, no navegador.

## Estado atual — 6 de 6 partes prontas

- [x] Importar live por arquivo do PC ou link (Twitch, YouTube, Kick)
- [x] Preview leve em 480p + forma de onda do áudio
- [x] Timeline com zoom, seleção por arraste e atalhos de teclado
- [x] Cortes manuais, por lista de timestamps, ajuste fino de 0,1 s e prévia
- [x] Exportação em fila (corte no formato original), com cancelamento
- [x] Detecção automática de hardware (qualquer placa de vídeo)
- [x] Parte 2 — transcrição automática (Whisper, palavra por palavra), idioma por projeto (PT / EN / misto),
      texto sincronizado, busca sem acentos com margem antes/depois, corte a partir de texto selecionado
- [x] Parte 3 — legendas estilo TikTok queimadas no vídeo + .SRT: 4 estilos prontos (Clássico viral, Caixa
      colorida, Minimalista, Neon), editor de estilos com prévia ao vivo, palavra falada destacada com animação
      pop, palavras-chave coloridas, emojis automáticos (dicionário editável), editor de legenda por corte
- [x] Parte 4 — formatos 9:16 recorte (ajustável), 9:16 câmera + jogo (retângulos desenhados no quadro),
      9:16 fundo desfocado, 16:9, 1:1 e original; vários formatos por corte (um arquivo cada); página Marca
      com logo, gancho (título no topo), intro/outro e música que abaixa sozinha na fala; prévia por formato
- [x] Parte 5 — momentos virais: o Gemini lê a transcrição (com os picos de volume como pista), sugere
      trechos com nota, motivo, nome e gancho; cortes encaixados em frases completas; sem chave, sugestões
      por volume + palavras-chave; roda sozinho após a transcrição; aba "Momentos" com "Virar corte"
- [x] Parte 6 — thumbnails (YouTube 1280×720, vertical 1080×1920, quadrada 1080×1080): 6 melhores quadros
      (rosto, nitidez e volume), recorte da pessoa por IA local, 4 templates + templates próprios, textos
      sugeridos pelo Gemini, editor com camadas (texto, emoji, imagem, seta, círculo, retângulo, ajustes de
      imagem, contorno, desfazer) e exportação em PNG

## Instalação (Windows 10/11)

1. Copie a pasta `cortes-live` inteira para o PC (a pasta `dados` pode ficar de fora).
2. Dê dois cliques em **`instalar.bat`**. Ele instala, se faltar:
   - **uv**: instala o Python 3.12 e as bibliotecas isoladas, sem mexer no resto do PC;
   - **FFmpeg**: via winget;
   - **Deno**: via winget, necessário para links do YouTube (pulado se o Node já existir).
3. Dê dois cliques em **`iniciar.bat`**. O navegador abre em http://127.0.0.1:8765.

Se os links pararem de funcionar (os sites mudam com frequência), rode **`atualizar-downloader.bat`**.

## Hardware

Na abertura, o programa testa de verdade os codificadores de vídeo e usa o primeiro que funcionar:
NVIDIA NVENC → Intel Quick Sync → AMD AMF → processador (x264).

Para a transcrição (parte 2), ele escolhe o modelo do Whisper pela placa NVIDIA:

| Placa | Exemplo | Escolha |
|---|---|---|
| RTX 20/30/40/50 (6 GB+) | RTX 3060 | large-v3-turbo, float16 |
| GTX 10xx / 16xx (4 GB+) | GTX 1060 6GB, GTX 1650 | large-v3-turbo, int8 |
| GTX 10xx (2 GB) | GTX 1050 | small, int8 |
| Maxwell (GTX 900) | GTX 970 | small, float32 |
| Muito antiga, driver < 525 ou sem NVIDIA | GT 730, Intel, AMD | processador, modelo small |

Se o modo escolhido falhar, ele tenta os modos de reserva e, por último, o processador.
Veja tudo em **Configurações** no site, onde também dá para trocar o modelo e o dispositivo.

A transcrição roda numa fila separada: dá para cortar e exportar enquanto ela acontece.
O modelo é baixado na primeira vez (small ≈ 0,5 GB, large-v3-turbo ≈ 1,6 GB) para `dados/modelos`.
Velocidade de referência: num processador de 4 núcleos, o modelo small leva ~1/3 da duração da live.
Numa GTX 1060, o large-v3-turbo deve levar bem menos (não testado ainda).

## Atalhos do editor

| Tecla | Ação |
|---|---|
| Espaço | tocar / pausar |
| I / O | marcar início / fim |
| Enter | criar corte |
| Esc | limpar seleção |
| ← / → | voltar / avançar 1 s (Shift: 5 s) |
| , / . | voltar / avançar 0,1 s |
| Rolagem na timeline | zoom (Shift + rolagem move) |

## Legendas

- As fontes ficam em `fontes/`: Montserrat, Anton, Bebas Neue, Poppins Black (licença OFL) e Luckiest Guy (Apache).
  As licenças estão na mesma pasta. Para usar outra fonte, coloque o `.ttf`/`.otf` nessa pasta.
  Impact, Arial Black e Segoe UI Black do Windows também aparecem na lista.
- Os emojis coloridos usam a fonte de emoji do próprio Windows (Segoe UI Emoji); nada é baixado.
- Estilos, emojis e palavras-chave ficam em `dados/estilos.json`, `dados/emojis.json` e `dados/palavras_chave.json`.
- Cada corte exportado com legenda gera também um `.srt` com o mesmo nome.

## Formatos e marca

- Cada corte tem **⚙ Formatos e extras**: marque os formatos (cada um vira um arquivo `nome_id_formato.mp4`),
  ajuste o recorte, escreva o gancho e ligue/desligue logo, intro, outro e música. A prévia ao lado mostra
  o quadro final (intro, outro e música só aparecem no vídeo exportado).
- **9:16 câmera + jogo**: em "Marcar câmera e jogo" desenhe os dois retângulos num quadro da live. Vale para o
  projeto inteiro e pode virar o padrão dos próximos. A legenda fica na divisa entre câmera e jogo.
- **Marca** (menu): arquivos e aparência de logo, gancho, intro/outro e música, e formatos padrão.
  Os arquivos continuam onde você os guardou; só o caminho é salvo em `dados/marca.json`.
- Música: repete se for curta, entra e sai suavemente, e abaixa cerca de 10 dB quando alguém fala.

## Momentos virais (Gemini)

1. Crie uma chave grátis em https://aistudio.google.com/apikey (conta Google).
2. Em **Configurações → Momentos virais**, cole a chave, clique em **Salvar chave** e depois em **Testar**.
   A chave fica só em `dados/ajustes.json` neste PC e vai no cabeçalho dos pedidos (nunca na URL).
3. O modelo é escolhido sozinho: o Gemini Flash estável mais novo disponível para a sua chave.
   Também dá para fixar um modelo.

- Lives longas são enviadas em partes de cerca de 30 mil tokens, para caber no limite gratuito. Se o limite
  estourar, o programa espera e tenta de novo. Se o Gemini falhar, as sugestões saem só por volume e
  palavras-chave, e a aba Momentos avisa o motivo.
- No plano gratuito, o Google pode usar os textos enviados para melhorar os produtos dele.
- O chat da live não é usado.

## Thumbnails

- Em cada corte, use **🖼 Thumbnail**. O editor abre com o melhor quadro e o template "Reação" já montados.
  Os outros 5 quadros candidatos ficam à esquerda.
- **✂ Recortar pessoa do fundo** usa o modelo `isnet-general-use`, o mesmo do rembg. Ele é baixado uma vez
  (~178 MB, de github.com/danielgatis/rembg) para `dados/modelos` e depois roda offline no processador
  (~2-3 s por quadro).
- Os 3 tamanhos têm designs separados. "Salvar design" guarda para editar depois; "Exportar PNG" grava
  `nome_id_thumb_tamanho.png` na pasta de exportados.
- "Salvar design como template" guarda o layout em proporções, então ele funciona nos três tamanhos.
- Imagens adicionadas no editor ficam em `dados/thumb_imagens` para reusar.

## Onde ficam os arquivos

- `dados/projetos/<id>/`: preview, forma de onda e o vídeo baixado (links)
- `dados/exportados/`: cortes prontos
- `dados/banco.sqlite3`: projetos, cortes e fila

Excluir um projeto apaga só a pasta interna dele. O seu arquivo original e os cortes exportados ficam.

## Desenvolvimento

```
cd backend
uv run uvicorn app.main:app --reload --port 8765
```
```
cd frontend
npm install
npm run dev     # http://localhost:5173 (repassa /api para a porta 8765)
npm run build   # gera frontend/dist, servido pelo backend
```

Use apenas lives suas ou com permissão do criador.
