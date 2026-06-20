# Hand Chord Wheel

Site estático que usa rastreamento de pontos da mão com MediaPipe e gera um som contínuo de acorde com a Web Audio API.

A ideia é simples: existe uma roda com acordes. O indicador da mão escolhe o setor da roda. Quando a mão se move para outro acorde, o som troca para o acorde equivalente.

## Funcionalidades

- Rastreamento da mão pela webcam.
- Uso do ponto do indicador para selecionar acordes.
- Roda visual com 12 acordes.
- Som contínuo sintetizado no navegador, sem arquivos `.mp3`.
- Troca suave entre acordes.
- Controle de volume.
- Controle de suavização para reduzir tremedeira na seleção.
- Pronto para GitHub Pages.

## Como rodar localmente

Você precisa abrir o projeto em um servidor local. Não abra o `index.html` direto pelo explorador de arquivos, porque webcam e módulos JavaScript podem ser bloqueados.

### Opção 1: usando Node.js

```bash
npm install
npm run dev
```

Depois abra o endereço que aparecer no terminal, normalmente:

```txt
http://localhost:5173
```

### Opção 2: usando Python

```bash
python -m http.server 5173
```

Depois abra:

```txt
http://localhost:5173
```

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub.
2. Envie todos os arquivos deste projeto.
3. No GitHub, entre em **Settings > Pages**.
4. Em **Build and deployment**, escolha **GitHub Actions**.
5. Faça um push na branch `main`.
6. O workflow incluído vai publicar o site automaticamente.

Também dá para publicar pelo modo simples do Pages usando a branch `main` e a pasta `/root`, porque o projeto é estático.

## Como trocar os acordes

Edite o arquivo:

```txt
js/chords.js
```

A lista principal fica em `CHORDS`:

```js
export const CHORDS = [
  { label: "C", root: "C", quality: "major" },
  { label: "G", root: "G", quality: "major" }
];
```

Qualidades aceitas:

- `major`
- `minor`
- `diminished`
- `augmented`
- `sus2`
- `sus4`
- `major7`
- `minor7`
- `dominant7`

## Observações importantes

- A webcam só funciona em `localhost` ou em site com HTTPS. GitHub Pages funciona porque usa HTTPS.
- O áudio precisa de clique do usuário para iniciar. Isso é regra dos navegadores modernos.
- O vídeo é espelhado para ficar natural como webcam frontal.
- O projeto usa o modelo `hand_landmarker.task` hospedado pelo Google. Então precisa de internet para carregar o MediaPipe e o modelo.

## Estrutura

```txt
hand-chord-wheel/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   └── chords.js
├── package.json
├── README.md
├── LICENSE
└── .github/
    └── workflows/
        └── deploy-pages.yml
```
