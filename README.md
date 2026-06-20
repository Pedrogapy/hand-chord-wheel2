# Hand Chord Keys

Site estático que usa rastreamento de pontos das mãos com MediaPipe e gera sons contínuos de acordes com a Web Audio API.

Agora existem duas linhas de teclas dentro da câmera:

- **Mão esquerda:** controla a linha de teclas no lado esquerdo, com acordes menores.
- **Mão direita:** controla a linha de teclas no lado direito, com acordes maiores.
- As duas linhas podem tocar simultaneamente.
- Fechar uma mão em punho silencia apenas a linha daquela mão.
- Abrir a mão novamente desilencia apenas aquela linha.

## Funcionalidades

- Rastreamento de até duas mãos pela webcam.
- Uso do ponto do indicador para selecionar acordes.
- Linha esquerda com acordes menores, incluindo `Am`, `Em` e `Fm`.
- Linha direita com acordes maiores, mantendo a lógica original.
- Som contínuo sintetizado no navegador, sem arquivos `.mp3`.
- Duas fontes sonoras independentes, uma para cada linha de teclas.
- Controle de volume geral.
- Controle de suavização para reduzir tremedeira na seleção.
- Opção para inverter esquerda/direita caso a câmera reconheça as mãos ao contrário.
- Layout com câmera ocupando quase todo o site.
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

## Como atualizar no GitHub

Substitua os arquivos do repositório por esta versão e rode:

```bash
git add .
git commit -m "Trocar rodas por linhas de teclas"
git push
```

Se você ainda tiver a pasta `.github` antiga no seu repositório e estiver publicando pelo modo simples do GitHub Pages, pode remover com:

```bash
git rm -r .github
git commit -m "Remover workflow antigo do GitHub Pages"
git push
```

## Como publicar no GitHub Pages

Como o projeto é estático, o modo mais simples é:

1. Entre no repositório no GitHub.
2. Vá em **Settings > Pages**.
3. Em **Build and deployment**, escolha **Deploy from a branch**.
4. Em **Branch**, escolha `main`.
5. Em **Folder**, escolha `/root`.
6. Salve.

## Como trocar os acordes

Edite o arquivo:

```txt
js/chords.js
```

A linha da direita usa:

```js
export const MAJOR_CHORDS = [
  { label: "C", root: "C", quality: "major" },
  { label: "G", root: "G", quality: "major" }
];
```

A linha da esquerda usa:

```js
export const MINOR_CHORDS = [
  { label: "Am", root: "A", quality: "minor" },
  { label: "Em", root: "E", quality: "minor" }
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
- Se mão esquerda/direita ficarem invertidas, marque a opção **Inverter mãos** no painel inferior.
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
└── .gitignore
```
