# Cortes Live

Programa para transformar lives em cortes prontos para TikTok, Reels e Shorts: ele transcreve a live, acha os
momentos com mais chance de viralizar, coloca legenda estilo TikTok, gera os formatos (9:16, 1:1, 16:9…) e
as thumbnails. Tudo roda no seu PC (Windows 10/11), em qualquer placa de vídeo.

**[⬇ Baixar o instalador (Windows)](https://github.com/clatzao/cortes-live/releases/latest)**

Use apenas lives suas ou com permissão do criador.

## Sumário

- [O que ele faz](#o-que-ele-faz)
- [Instalação fácil: programa de desktop](#instalação-fácil-programa-de-desktop-windows-1011)
- [Instalação pelo código](#instalação-pelo-código-sem-o-instalador)
- [Como usar](#como-usar-resumo)
- [Atalhos do editor](#atalhos-do-editor)
- [Hardware](#hardware) · [Legendas](#legendas) · [Formatos e marca](#formatos-e-marca) ·
  [Momentos virais](#momentos-virais-gemini) · [Thumbnails](#thumbnails)
- [Onde ficam os arquivos](#onde-ficam-os-arquivos)
- [Estrutura do código](#estrutura-do-código) · [Desenvolvimento](#desenvolvimento)

## O que ele faz

- **Importar** a live por arquivo do PC ou link (Twitch, YouTube, Kick). Gera um preview leve, a forma de
  onda e uma tira de miniaturas para a timeline.
- **Transcrição automática** (Whisper, palavra por palavra) em PT, EN ou misto. O texto acompanha o vídeo, tem
  busca sem acentos e vira corte selecionando um trecho.
- **Momentos virais**: o Gemini (grátis) lê a transcrição, com os picos de volume como pista, e sugere trechos
  com nota, motivo, nome e gancho, encaixados em frases completas. Sem chave, as sugestões saem só por volume
  e palavras-chave. Dá para aceitar vários de uma vez.
- **Modo automático**: ao importar, ele transcreve, acha os momentos e já cria os cortes; você só revisa e exporta.
- **Editor com timeline**: miniaturas, onda com os trechos altos em destaque, zoom, seleção arrastando e bordas
  dos cortes arrastáveis. Também cria cortes por I/O + Enter, pelo texto ou colando uma lista de horários.
- **Legendas estilo TikTok** queimadas no vídeo, mais o `.srt`. São 4 estilos prontos e um editor de estilos;
  a palavra falada ganha destaque com animação pop, as palavras-chave ficam coloridas e entram emojis
  automáticos. Cada corte tem seu editor de legenda.
- **Formatos**: 9:16 recorte (ajustável), 9:16 câmera + jogo, 9:16 fundo desfocado, 16:9, 1:1 e original.
  Cada corte pode sair em vários formatos.
- **Marca do canal**: logo, gancho (título no topo), intro/outro e música que abaixa sozinha na fala.
- **Thumbnails** (YouTube, vertical e quadrada):
  - os 6 melhores quadros, escolhidos por rosto, nitidez e volume;
  - recorte da pessoa por IA local e templates;
  - editor com camadas, exportado em PNG.
- **Padrão dos cortes**: estilo de legenda, formatos e extras com que todo corte novo nasce.
- **Exportação em fila**, com "Exportar todos". Os arquivos vão organizados em `Vídeos\Cortes Live`.
- Detecta o hardware e se adapta a ele: NVENC, Quick Sync, AMF ou processador, e o modelo do Whisper que cabe
  na sua placa.
- Visual escuro estilo estúdio; o botão de sol/lua troca para o claro.

## Instalação fácil: programa de desktop (Windows 10/11)

1. Baixe o instalador:
   **[Cortes.Live_0.2.0_x64-setup.exe](https://github.com/clatzao/cortes-live/releases/download/v0.2.0/Cortes.Live_0.2.0_x64-setup.exe)**
   (12 MB; versões novas ficam em [Releases](https://github.com/clatzao/cortes-live/releases)) e abra. Ele instala só para o seu usuário
   (não pede administrador) e cria o atalho no menu Iniciar e na área de trabalho.
   Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**
   (o instalador não é assinado digitalmente).
2. Abra o **Cortes Live**. Na **primeira vez** ele prepara tudo sozinho, com o progresso na tela:
   baixa o FFmpeg (~200 MB, se o PC ainda não tiver), o Python e as bibliotecas (~400 MB; com placa NVIDIA,
   mais ~1,5 GB de CUDA). Depois disso abre em poucos segundos.
3. O programa abre na própria janela. Fechar a janela encerra tudo (inclusive exportações em andamento).

Os projetos, ajustes e modelos de IA do programa instalado ficam em `%LOCALAPPDATA%\br.cortes.live`; os
cortes prontos vão para `Vídeos\Cortes Live`. Para atualizar, instale a versão nova por cima.
Para desinstalar: **Configurações do Windows → Aplicativos → Cortes Live**.

## Instalação pelo código (sem o instalador)

Use este caminho se preferir rodar pelo navegador ou não quiser o instalador.

1. **Baixe o projeto** (o repositório é público, não precisa de login):
   - **Sem Git:** em https://github.com/clatzao/cortes-live clique em **Code → Download ZIP** e extraia
     a pasta para um lugar fixo (ex.: `C:\Cortes Live`). Evite deixar dentro de Downloads.
   - **Com Git:** `git clone https://github.com/clatzao/cortes-live.git`.

   O site já vem compilado em `frontend/dist`, então o PC não precisa de Node.
2. Dê dois cliques em **`instalar.bat`** e espere terminar. Ele instala, se faltar:
   - **uv**: instala o Python 3.12 e as bibliotecas isoladas, sem mexer no resto do PC;
   - **FFmpeg**: via winget;
   - **Deno**: via winget, necessário para links do YouTube (pulado se o Node já existir);
   - com placa **NVIDIA**: também as bibliotecas CUDA para a transcrição (~1,5 GB).

   Se ele avisar que instalou o FFmpeg ou o Deno, feche a janela antes do passo 3.
3. Dê dois cliques em **`iniciar.bat`**. O navegador abre sozinho em http://127.0.0.1:8765.
   Deixe a janela preta aberta enquanto usa; fechar a janela encerra o programa.
4. (Opcional) Em **Ajustes → IA e hardware**, cole a chave grátis do Gemini para os momentos virais
   (veja "Momentos virais" abaixo). Sem chave, ele sugere momentos só por volume e palavras-chave.

**Atualizar para a versão mais nova:** com Git, rode `git pull` na pasta. Com ZIP, baixe o ZIP de novo e
extraia por cima da pasta antiga (seus projetos e ajustes ficam em `dados/` e não são apagados). Depois rode
o `instalar.bat` de novo.

Se os links pararem de funcionar (os sites mudam com frequência), rode **`atualizar-downloader.bat`**.

## Como usar (resumo)

1. Em **Projetos**, cole o link da live ou clique em **Procurar arquivo…** e depois em **Importar**.
   Marque **Criar os cortes automaticamente** para ele transcrever, achar os momentos e já criar os cortes.
2. Abra o projeto. Na aba **Momentos**, marque os trechos e clique em **Virar N cortes** (ou crie cortes
   arrastando na timeline, com I/O + Enter, pelo **Texto** ou colando **Horários**).
3. Ajuste os cortes na timeline puxando as bordas. Em **Editar**, mude legenda, formatos, gancho e thumbnail.
4. Clique em **Exportar todos**. Os arquivos vão para `Vídeos\Cortes Live\<live>\<corte>`.

O jeito que todo corte novo nasce (estilo de legenda, formatos, logo/intro/outro/música, duração dos
momentos) fica em **Ajustes → Padrão dos cortes**.

## Hardware

Na abertura, o programa testa de verdade os codificadores de vídeo e usa o primeiro que funcionar:
NVIDIA NVENC → Intel Quick Sync → AMD AMF → processador (x264).

Para a transcrição, ele escolhe o modelo do Whisper pela placa NVIDIA:

| Placa | Exemplo | Escolha |
|---|---|---|
| RTX 20/30/40/50 (6 GB+) | RTX 3060 | large-v3-turbo, float16 |
| GTX 10xx / 16xx (4 GB+) | GTX 1060 6GB, GTX 1650 | large-v3-turbo, int8 |
| GTX 10xx (2 GB) | GTX 1050 | small, int8 |
| Maxwell (GTX 900) | GTX 970 | small, float32 |
| Muito antiga, driver < 525 ou sem NVIDIA | GT 730, Intel, AMD | processador, modelo small |

Se o modo escolhido falhar, ele tenta os modos de reserva e, por último, o processador.
Veja tudo em **Ajustes → IA e hardware** no site, onde também dá para trocar o modelo e o dispositivo.

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
| + / − | aproximar / afastar a timeline (0: ver tudo) |
| Rolagem na timeline | zoom (Shift + rolagem move) |
| Arrastar na timeline | selecionar um trecho |
| Arrastar a borda de um corte | ajustar início/fim (arrastar o meio da faixa move o corte inteiro) |
| Dois cliques num corte | zoom no corte |

## Legendas

- As fontes ficam em `fontes/`: Montserrat, Anton, Bebas Neue, Poppins Black (licença OFL) e Luckiest Guy (Apache).
  As licenças estão na mesma pasta. Para usar outra fonte, coloque o `.ttf`/`.otf` nessa pasta.
  Impact, Arial Black e Segoe UI Black do Windows também aparecem na lista.
- Os emojis coloridos usam a fonte de emoji do próprio Windows (Segoe UI Emoji); nada é baixado.
- Estilos, emojis e palavras-chave ficam em `dados/estilos.json`, `dados/emojis.json` e `dados/palavras_chave.json`.
- Cada corte exportado com legenda gera também um `.srt` com o mesmo nome.

## Formatos e marca

- Em cada corte, **Editar → Formatos e extras**: marque os formatos (cada um vira um arquivo, ex.: `9x16 recorte.mp4`),
  ajuste o recorte, escreva o gancho e ligue/desligue logo, intro, outro e música. A prévia ao lado mostra
  o quadro final (intro, outro e música só aparecem no vídeo exportado).
- **9:16 câmera + jogo**: em "Marcar câmera e jogo" desenhe os dois retângulos num quadro da live. Vale para o
  projeto inteiro e pode virar o padrão dos próximos. A legenda fica na divisa entre câmera e jogo.
- **Ajustes → Marca do canal**: arquivos e aparência de logo, gancho, intro/outro e música.
  O que vem ligado nos cortes novos (e os formatos padrão) fica em **Ajustes → Padrão dos cortes**.
  Os arquivos continuam onde você os guardou; só o caminho é salvo em `dados/marca.json`.
- Música: repete se for curta, entra e sai suavemente, e abaixa cerca de 10 dB quando alguém fala.

## Momentos virais (Gemini)

1. Crie uma chave grátis em https://aistudio.google.com/apikey (conta Google).
2. Em **Ajustes → IA e hardware → Momentos virais**, cole a chave, clique em **Salvar chave** e depois em **Testar**.
   A chave fica só em `dados/ajustes.json` neste PC e vai no cabeçalho dos pedidos (nunca na URL).
3. O modelo é escolhido sozinho: o Gemini Flash estável mais novo disponível para a sua chave.
   Também dá para fixar um modelo.

- Lives longas são enviadas em partes de cerca de 30 mil tokens, para caber no limite gratuito. Se o limite
  estourar, o programa espera e tenta de novo. Se o Gemini falhar, as sugestões saem só por volume e
  palavras-chave, e a aba Momentos avisa o motivo.
- No plano gratuito, o Google pode usar os textos enviados para melhorar os produtos dele.
- O chat da live não é usado.

## Thumbnails

- Em cada corte, use **Editar → Thumbnail**. O editor abre com o melhor quadro e o template "Reação" já montados.
  Os outros 5 quadros candidatos ficam à esquerda.
- **✂ Recortar pessoa do fundo** usa o modelo `isnet-general-use`, o mesmo do rembg. Ele é baixado uma vez
  (~178 MB, de github.com/danielgatis/rembg) para `dados/modelos` e depois roda offline no processador
  (~2-3 s por quadro).
- Os 3 tamanhos têm designs separados. "Salvar design" guarda para editar depois; "Exportar PNG" grava
  `Thumbnail <tamanho>.png` na pasta do corte.
- "Salvar design como template" guarda o layout em proporções, então ele funciona nos três tamanhos.
- Imagens adicionadas no editor ficam em `dados/thumb_imagens` para reusar.

## Onde ficam os arquivos

- `Vídeos\Cortes Live\<live>\<corte (id)>\`: cortes prontos, um arquivo por formato, o `.srt` e as thumbnails
  (para outro local, defina a variável de ambiente `CORTES_EXPORTADOS`)
- `dados/projetos/<id>/`: preview, forma de onda, miniaturas da timeline e o vídeo baixado (links)
- `dados/banco.sqlite3`: projetos, cortes e fila

`dados/` é a pasta `dados` do projeto (versão pelo código) ou `%LOCALAPPDATA%\br.cortes.live\dados` (programa
instalado). Lá também ficam `ajustes.json` (inclui a chave do Gemini), `marca.json`, os estilos de legenda e os
modelos de IA em `modelos/`.

Excluir um projeto apaga só a pasta interna dele. O seu arquivo original e os cortes exportados ficam.

## Estrutura do código

```
backend/                 servidor local (Python 3.12, FastAPI, gerenciado pelo uv)
  app/main.py            cria o servidor, junta as rotas e serve o site
  app/rotas/             rotas da API por assunto: projetos, cortes, legendas, marca, momentos,
                         fila, thumbs, sistema (hardware/ajustes) e comum (funções compartilhadas)
  app/tarefas.py         tarefas da fila: importar e exportar
  app/transcricao.py     Whisper (faster-whisper) em blocos, palavra por palavra
  app/viral.py           momentos virais (Gemini + sinais de volume e palavras)
  app/legendas.py        desenho das legendas (Pillow) e .srt
  app/formatos.py        comando do FFmpeg de cada formato (exportação e prévia)
  app/marca.py           logo, gancho, intro/outro, música
  app/thumbs.py          quadros candidatos, recorte da pessoa (ONNX), designs e templates
  app/media.py           FFmpeg: análise, preview, forma de onda, miniaturas
  app/hardware.py        detecção de placa e codificadores
  app/cortes.py          criação de cortes com o padrão do usuário
  app/jobs.py, db.py     fila em segundo plano e banco SQLite
frontend/                site (React + Vite + TypeScript); o build fica em frontend/dist
  src/paginas/           Início (projetos), Editor, Fila e Ajustes (Padrão dos cortes, Legendas,
                         Marca do canal, IA e hardware)
  src/componentes/       Timeline, painéis do editor (Momentos, Texto), cartão e janela do corte
  src/thumb/             editor de thumbnail (Konva, carregado só quando abre)
desktop/                 programa de desktop (Tauri 2, Rust) e o instalador
  src-tauri/src/main.rs  tela de abertura, preparação (FFmpeg, Python), liga e desliga o motor
  ui/index.html          tela de abertura
fontes/                  fontes livres das legendas (com as licenças)
instalar.bat, iniciar.bat, atualizar-downloader.bat   versão pelo código, sem instalador
```

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

Programa de desktop (Tauri, em `desktop/`; precisa de Rust e das ferramentas de build C++ do Visual Studio):

```
cd desktop
npm install
npm run build   # gera desktop/src-tauri/target/release/bundle/nsis/Cortes Live_<versão>_x64-setup.exe
```

O app em Rust (`desktop/src-tauri/src/main.rs`) mostra a tela de abertura, baixa o FFmpeg, instala o Python e
as bibliotecas com o `uv` embutido, liga o motor numa porta livre e o encerra junto com a janela (job object
do Windows). A compilação ocupa ~2-3 GB em `desktop/src-tauri/target`; `cargo clean` dentro de
`desktop/src-tauri` libera o espaço.
