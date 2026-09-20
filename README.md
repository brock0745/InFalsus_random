# jackets フォルダ

ジャケット画像をここに入れると、結果カードに表示されます。**拡張子は webp / png / jpg のどれでも構いません**（変換は不要です）。

## 入れ方は2通り

**方法1: ファイル名を「曲ID.拡張子」にする（songs.json の編集不要）**
例: `cryogenic.png` / `hyalouyne.webp` / `zetta.jpg`
`webp` → `png` → `jpg` → `jpeg` の順に自動で探します。

**方法2: songs.json に「jacket」でファイル名を書く（名前は自由）**
```json
{"id": "cryogenic", "title": "Cryogenic", "artist": "…", "arc": 0, "lv": {"MIN": 2, "EVO": 5, "ULT": 9, "FBD": 12}, "jacket": "cover_001.png"},
```
フォルダ名は付けず、ファイル名だけを書きます。書いた曲は、方法1より優先されます。

## 注意

- ファイル名の**大文字・小文字は区別**されます（GitHub Pages のため）。`Cryogenic.PNG` と `cryogenic.png` は別物です。拡張子は小文字にしてください。
- 画像は正方形がきれいに収まります（縦横比が違うと中央で切り抜かれます）。
- 表示サイズは最大でも約 240px です。原画が数MBある場合は、1000px 前後に縮小すると読み込みが速くなります。
- 画像が無い曲は、自動でプレースホルダー表示になります。
- 画像の扱いは、公式の二次創作ガイドラインの範囲で行ってください。

## 曲ID一覧

| 曲ID | 曲名 |
|---|---|
| `altered-edge` | Altered Edge |
| `deep-into-the-vibe` | Deep Into The Vibe |
| `f0-cha0s` | F0 CHA0S |
| `latent-duality` | Latent Duality |
| `memories-in-noise` | Memories in Noise |
| `new-vision` | New Vision |
| `transparency` | Transparency |
| `wonderroom2-0` | WonderRoom2.0 |
| `zfc` | ZFC |
| `chronomia` | Chronomia |
| `enigma` | Enigma |
| `ffff` | FFFF |
| `greyscale-city` | Greyscale City |
| `hanabi` | Hanabi |
| `init` | init() |
| `moondiver` | M / O / O / N / D / I / V / E / R |
| `minerva` | Minerva |
| `sin-utopia` | Sin Utopia |
| `with-truth` | With Truth |
| `cylin` | cylin |
| `everything` | Everything |
| `kirapico-riot` | Kirapico Riot: Kirapicorin |
| `lights-out` | Lights Out |
| `memoire` | Mémoire |
| `neonvision` | NEONViSION |
| `papillon-blanc` | papillon blanc |
| `primeval-texture` | Primeval Texture |
| `things-i-treasure` | Things I Treasure |
| `chaoticism-legacy` | Chaoticism Legacy |
| `code-leviathan` | code:Leviathan |
| `cold-sea` | Cold Sea |
| `falling-shadow` | Falling Shadow |
| `live-fast-die-young` | Live Fast Die Young |
| `my-deadly-sins` | My Deadly Sins |
| `re-flection` | Re:Flection |
| `reconnect` | Reconnect |
| `self-confrontation` | Self-confrontatioN |
| `should-have-been` | Should have been |
| `trajectory-of-hope` | Trajectory of Hope |
| `vesper` | Vesper |
| `yggthrasir` | yggthrasir |
| `hidden-fbd15` | ▓ |
| `albedo` | Albedo |
| `chronophobia` | Chronophobia |
| `destr0yer` | Destr0yer |
| `exceed-mind-limit` | EXCEED MIND LIMIT |
| `falsequre` | Falsequre |
| `hollow` | Hollow |
| `kiretsu` | KIRETSU |
| `moonsliders` | Moonsliders |
| `noct-idea` | Noct Idea |
| `now-i-know` | Now I know |
| `outer-justice` | Outer Justice |
| `phylaxron` | PhylaXron |
| `rainshower` | Rainshower |
| `scarlet-espada` | Scarlet Espada |
| `shadows-of-unknown` | Shadows of Unknown |
| `tactom` | TACTOM |
| `toccata-funebre` | Toccata Funebre |
| `world-ender` | World Ender |
| `zetta` | Zetta |
| `a-la-mode` | à la mode |
| `be-there` | Be There |
| `cryogenic` | Cryogenic |
| `cyaegha` | Cyaegha |
| `forbidden-souls` | Forbidden Souls |
| `ghost-ray` | Ghost Ray |
| `hyalouyne` | Hyaloüyne |
| `mirinae` | MIRINAE |
| `ordirehv` | Ordirehv |
