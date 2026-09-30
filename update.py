#!/usr/bin/env python3
"""songs.json の検査・曲の追加・公開URLの一括置換をするツール（標準ライブラリのみ）

使い方（このファイルがあるフォルダで実行）
  python update.py check
      songs.json の書式と中身を検査します。GitHub に上げる前に毎回実行するのがおすすめ。
      全角のカンマ・コロン・引用符、カンマ抜けなどの場所を行番号つきで教えます。

  python update.py add --id new-song --title "New Song" --artist "Someone" --arc 4 --lv 3 6 10 12
      曲を追加します（--lv は MIN EVO ULT FBD の順）。日本語表記があれば --ja "..." も付けます。
      同じ章の最後に入り、"updated" が今日の日付になります。
      Arc（章）の曲ではなく、パックの曲を足すときは --arc の代わりに --pack パックID を使います
      （例: --pack virtual-singers）。パックは先に add-pack で登録してください。

  python update.py add-pack --id virtual-singers --label "Virtual Singers"
      新しいパック（Arc に属さない曲のまとまり）を songs.json に登録します。
      表示順は「Arc をすべて数字順で並べた後ろに、登録した順」に固定されるので、
      Arc 5 などの新しい章が後から増えても、常に全パックより手前に並びます。

  python update.py jackets [--dry-run] [--yes]
      jackets フォルダの画像のファイル名を読み取り、曲名などから曲を判定して
      songs.json の "jacket" に実際のファイル名（拡張子つき）を書き込みます。
      綴りが少し違う名前（Alterd_Edge など）も候補として拾い、どの対応かを表示します。

  python update.py url https://ユーザー名.github.io/リポジトリ名/
      index.html と sitemap.xml に書かれている公開URLをまとめて置き換えます。
"""
import argparse
import datetime
import json
import re
import sys
import unicodedata
import difflib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SONGS = ROOT / "songs.json"
TIERS = ["MIN", "EVO", "ULT", "FBD"]
IMG_EXT = (".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif", ".bmp")
FULLWIDTH = set("，、：；“”‘’（）［］｛｝")   # JSON の記号として使ってはいけない全角文字


def scan_fullwidth(text):
    """文字列の外側にある全角記号を探す（JSON では構文エラーになる）"""
    problems, in_str, esc = [], False, False
    line, col = 1, 0
    for ch in text:
        col += 1
        if ch == "\n":
            line, col, esc = line + 1, 0, False
            continue
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            elif ch in "“”":
                problems.append((line, col, ch, "文字列の中に全角の引用符があります（半角の \" にしてください）"))
            continue
        if ch == '"':
            in_str = True
        elif ch in FULLWIDTH or ch == "\u3000":
            name = "全角スペース" if ch == "\u3000" else "全角の「%s」" % ch
            problems.append((line, col, ch, "文字列の外に%sがあります（半角にしてください）" % name))
    return problems


def load_songs_file():
    text = SONGS.read_text(encoding="utf-8")
    ok = True
    for line, col, _ch, msg in scan_fullwidth(text):
        print("  ✗ %d行目 %d文字目: %s" % (line, col, msg))
        ok = False
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        lines = text.splitlines()
        print("  ✗ JSON の書式エラー: %s（%d行目 %d文字目）" % (e.msg, e.lineno, e.colno))
        for n in range(max(1, e.lineno - 1), min(len(lines), e.lineno) + 1):
            print("      %4d | %s" % (n, lines[n - 1]))
        print("      ヒント: 直前の行の末尾のカンマ抜け、キー名や値の引用符（\"）抜け、"
              "コロン（:）抜け、最後の要素の後ろの余計なカンマを確認してください。")
        return None, False
    return data, ok


def cmd_check(_args):
    print("songs.json を検査します…")
    data, ok = load_songs_file()
    if data is None:
        return 1
    songs = data.get("songs") if isinstance(data, dict) else data
    if not isinstance(songs, list):
        print('  ✗ "songs" の配列がありません')
        return 1

    # "packs"（Arc 以外のまとまり）の登録一覧を検査する
    packs_def = data.get("packs", []) if isinstance(data, dict) else []
    pack_ids, pack_label = set(), {}
    if not isinstance(packs_def, list):
        print('  ✗ "packs" は配列にしてください'); errors_top = 1
    else:
        errors_top = 0
        for p in packs_def:
            if not isinstance(p, dict) or not p.get("id") or not p.get("label"):
                print("  ✗ packs の中に id か label が無い項目があります: %r" % (p,)); errors_top += 1; continue
            if p["id"] in pack_ids:
                print("  ✗ packs の id「%s」が重複しています" % p["id"]); errors_top += 1
            pack_ids.add(p["id"]); pack_label[p["id"]] = p["label"]

    seen = set()
    errors = warnings = errors_top
    for i, s in enumerate(songs, 1):
        label = "%d番目（%s）" % (i, s.get("id") or s.get("title") or "?")
        if not s.get("id") or not s.get("title"):
            print("  ✗ %s: id と title は必須です" % label); errors += 1; continue
        if not re.fullmatch(r"[a-z0-9-]+", s["id"]):
            print("  ✗ %s: id は半角の小文字・数字・ハイフンだけにしてください" % label); errors += 1
        if s["id"] in seen:
            print("  ✗ %s: id が重複しています" % label); errors += 1
        seen.add(s["id"])
        has_arc, has_pack = "arc" in s, "pack" in s
        if has_arc == has_pack:
            print("  ✗ %s: arc か pack のどちらか一方だけを指定してください" % label); errors += 1
        elif has_arc:
            a = s["arc"]
            if not isinstance(a, (int, float)) or isinstance(a, bool) or a < 0 or round(a * 2) != a * 2:
                print("  ✗ %s: arc は 0 以上、0.5 刻みの数字にしてください（今: %r）" % (label, a)); errors += 1
        else:
            if s["pack"] not in pack_ids:
                print("  ✗ %s: pack「%s」が \"packs\" に登録されていません（先に add-pack で登録してください）" % (label, s["pack"])); errors += 1
        lv = s.get("lv") or {}
        vals = []
        for t in TIERS:
            v = lv.get(t)
            if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 15:
                print("  ✗ %s: lv.%s は 1〜15 の整数にしてください（今: %r）" % (label, t, v)); errors += 1
            else:
                vals.append(v)
        if len(vals) == 4 and vals != sorted(vals):
            print("  △ %s: MIN→EVO→ULT→FBD の順にレベルが上がっていません %s" % (label, vals)); warnings += 1

    # ジャケットの確認
    #   "jacket" は「拡張子つき」（cover.png）でも「拡張子なし」（cover）でもよい。
    #   拡張子なしなら、その名前の画像がどれか1つあればOK。
    jdir = ROOT / "jackets"
    files = {p.name for p in jdir.iterdir() if p.suffix.lower() in IMG_EXT} if jdir.exists() else set()
    stems = {}
    for f in files:
        stems.setdefault(Path(f).stem, []).append(f)
    lower_files = {f.lower(): f for f in files}
    lower_stems = {k.lower(): k for k in stems}
    used, missing, have, bad_jackets = set(), [], 0, []
    for s in songs:
        if not s.get("id"):
            continue
        j = s.get("jacket")
        if j:
            name = j.split("/")[-1]
            if name.lower().endswith(IMG_EXT):
                found = [name] if name in files else []
                hint = lower_files.get(name.lower())
            else:
                found = stems.get(name, [])
                hint = lower_stems.get(name.lower())
                hint = stems[hint][0] if hint else None
            if found:
                used.update(found); have += 1
            else:
                msg = "%s: jacket「%s」の画像が jackets フォルダにありません" % (s["id"], j)
                if hint:
                    msg += "（大文字小文字が違います。実際の名前は「%s」）" % hint
                bad_jackets.append(msg); errors += 1
        elif s["id"] in stems:
            used.update(stems[s["id"]]); have += 1
            bad = [f for f in stems[s["id"]] if Path(f).suffix != Path(f).suffix.lower()]
            if bad:
                print("  △ %s: 拡張子が大文字です（GitHub Pages では読み込めません）→ 小文字にしてください" % ", ".join(bad)); warnings += 1
        else:
            missing.append(s["id"])
    extra = sorted(files - used)
    if extra:
        print("  △ どの曲にも使われていない画像（ファイル名の誤りかも）: " + ", ".join(extra)); warnings += 1
    for msg in bad_jackets[:8]:
        print("  ✗ " + msg)
    if len(bad_jackets) > 8:
        print("  … ほか %d 件（画像を jackets に入れたか、python update.py jackets で対応づけ直してください）" % (len(bad_jackets) - 8))

    # Arc・パックごとの曲数（新しい章やパックが正しく認識されているかの一覧）
    from collections import Counter
    counts = Counter(("Arc " + ("Base" if s["arc"] == 0 else str(s["arc"])) if "arc" in s
                       else pack_label.get(s.get("pack"), "pack:" + str(s.get("pack"))))
                      for s in songs if "arc" in s or "pack" in s)
    print("章・パックごとの曲数: " + "　".join("%s %d曲" % (k, v) for k, v in counts.items()))
    unused_packs = sorted(pid for pid in pack_ids if pack_label[pid] not in counts)
    if unused_packs:
        print("  △ 曲が1つも無いパック（登録だけ済み）: " + ", ".join(unused_packs)); warnings += 1

    print("曲数: %d / エラー: %d / 注意: %d / ジャケット: %d 曲分あり・%d 曲分が未登録"
          % (len(songs), errors, warnings, have, len(missing)))
    if errors or not ok:
        print("→ 直してからもう一度実行してください。")
        return 1
    print("→ 問題ありません。")
    return 0


def format_songs_file(data):
    """1曲1行の読みやすい形で書き出す（手で編集しやすい形式を保つ）"""
    out = ["{"]
    for k, v in data.items():
        if k != "songs":
            out.append("  %s: %s," % (json.dumps(k, ensure_ascii=False), json.dumps(v, ensure_ascii=False)))
            if k == "packs":
                pass  # 配列だが1行にまとめて書く（曲ほど数が多くならないため）
    out.append('  "songs": [')
    n = len(data["songs"])
    for i, s in enumerate(data["songs"]):
        out.append("    " + json.dumps(s, ensure_ascii=False, separators=(", ", ": ")) + ("," if i < n - 1 else ""))
    out += ["  ]", "}"]
    return "\n".join(out) + "\n"


def cmd_add(args):
    data, ok = load_songs_file()
    if data is None or not ok:
        print("先に songs.json のエラーを直してください（python update.py check）。")
        return 1
    songs = data["songs"]
    if any(s["id"] == args.id for s in songs):
        print("id「%s」はすでにあります。" % args.id)
        return 1
    if not re.fullmatch(r"[a-z0-9-]+", args.id):
        print("id は半角の小文字・数字・ハイフンだけにしてください。")
        return 1
    if (args.arc is None) == (args.pack is None):
        print("--arc か --pack のどちらか一方だけを指定してください。")
        return 1
    if args.arc is not None and (args.arc < 0 or round(args.arc * 2) != args.arc * 2):
        print("--arc は 0 以上、0.5 刻みの数字にしてください（例: 0, 1, 2.5）。")
        return 1
    pack_ids = {p.get("id") for p in data.get("packs", []) if isinstance(p, dict)}
    if args.pack is not None and args.pack not in pack_ids:
        print("パック「%s」は登録されていません。先に次を実行してください:" % args.pack)
        print('  python update.py add-pack --id %s --label "表示したい名前"' % args.pack)
        return 1
    song = {"id": args.id, "title": args.title}
    if args.ja:
        song["ja"] = args.ja
    song["artist"] = args.artist
    if args.arc is not None:
        song["arc"] = int(args.arc) if float(args.arc).is_integer() else args.arc
        group = lambda s: s.get("arc") == song["arc"]
    else:
        song["pack"] = args.pack
        group = lambda s: s.get("pack") == song["pack"]
    song["lv"] = dict(zip(TIERS, args.lv))

    # 同じ章・同じパックの最後の曲の後ろに挿入（なければ末尾）
    idx = max((i for i, s in enumerate(songs) if group(s)), default=len(songs) - 1) + 1
    songs.insert(idx, song)
    data["updated"] = datetime.date.today().isoformat()
    SONGS.write_text(format_songs_file(data), encoding="utf-8")
    print("追加しました:", song["title"], "→ songs.json（%d曲）" % len(songs))
    print("ジャケットは jackets/%s.（webp か png か jpg）の名前で入れるか、songs.json の jacket にファイル名を書いてください。" % args.id)
    return 0


def cmd_add_pack(args):
    data, ok = load_songs_file()
    if data is None or not ok:
        print("先に songs.json のエラーを直してください（python update.py check）。")
        return 1
    packs = data.setdefault("packs", [])
    if any(p.get("id") == args.id for p in packs):
        print("パックID「%s」はすでにあります。" % args.id)
        return 1
    if not re.fullmatch(r"[a-z0-9-]+", args.id):
        print("パックID は半角の小文字・数字・ハイフンだけにしてください。")
        return 1
    packs.append({"id": args.id, "label": args.label})
    SONGS.write_text(format_songs_file(data), encoding="utf-8")
    print("パックを登録しました: %s（%s）" % (args.label, args.id))
    print("表示順は、既存のすべての Arc の後ろ・他のパックと同じ並び（登録した順）です。")
    print("曲を追加するときは: python update.py add --id … --pack %s --lv … " % args.id)
    return 0


def norm_name(s):
    """照合用に名前を整える: アクセント除去・全角半角の統一・小文字化・記号や空白や _ の除去
    例) "à la mode" と "a_la_mode"、"Re:Flection" と "ReFlection" が同じになる"""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = unicodedata.normalize("NFKC", s).lower()
    return re.sub(r"[\W_]+", "", s)


def cmd_jackets(args):
    data, ok = load_songs_file()
    if data is None or not ok:
        print("先に songs.json のエラーを直してください（python update.py check）。")
        return 1
    songs = data["songs"]
    jdir = ROOT / "jackets"
    files = sorted(p.name for p in jdir.iterdir() if p.suffix.lower() in IMG_EXT) if jdir.exists() else []
    if not files:
        print("jackets フォルダに画像がありません。")
        return 1

    # 曲ごとの照合キー（曲名・日本語表記・ID）
    keys = {}
    for s in songs:
        ks = {norm_name(s.get(k, "")) for k in ("title", "ja", "id")}
        keys[s["id"]] = {k for k in ks if k}

    assigned, how = {}, {}           # 曲ID → ファイル名 / 判定方法
    unmatched = []
    # 1) 正規化した名前が完全に一致
    for f in files:
        stem = norm_name(Path(f).stem)
        hit = [sid for sid, ks in keys.items() if stem in ks]
        if len(hit) == 1 and hit[0] not in assigned:
            assigned[hit[0]] = f; how[hit[0]] = "一致"
        else:
            unmatched.append(f)
    # 2) 綴りが少し違う名前を候補として拾う（類似度 0.85 以上で、2位との差が十分なもの）
    rest = []
    for f in unmatched:
        stem = norm_name(Path(f).stem)
        scored = sorted(((max(difflib.SequenceMatcher(None, stem, k).ratio() for k in ks), sid)
                         for sid, ks in keys.items() if sid not in assigned and ks), reverse=True)
        if scored and scored[0][0] >= 0.85 and (len(scored) < 2 or scored[0][0] - scored[1][0] >= 0.05):
            assigned[scored[0][1]] = f; how[scored[0][1]] = "類似 %.0f%%" % (scored[0][0] * 100)
        else:
            rest.append(f)
    # 3) 画像も曲も1つずつ余ったときは、消去法で対応させる（確認あり）
    left_songs = [s for s in songs if s["id"] not in assigned]
    if len(rest) == 1 and len(left_songs) == 1:
        s = left_songs[0]
        print("  ? 「%s」だけが残り、曲も「%s」（%s）の1つだけが残りました。" % (rest[0], s["title"], s["id"]))
        yes = args.yes
        if not yes and sys.stdin.isatty():
            yes = input("    これらを対応させますか？ [y/N] ").strip().lower() == "y"
        if yes:
            assigned[s["id"]] = rest[0]; how[s["id"]] = "消去法"; rest = []
        else:
            print("    → 対応させませんでした（--yes を付けると自動で対応させます）")

    changed = 0
    for s in songs:
        f = assigned.get(s["id"])
        if not f:
            continue
        new = f if not args.noext else Path(f).stem
        if s.get("jacket") != new:
            changed += 1
        s["jacket"] = new
        if how[s["id"]] != "一致":
            print("  ≈ %s: %s ← %s（%s）" % (s["id"], s["title"], f, how[s["id"]]))

    left_songs = [s for s in songs if s["id"] not in assigned]
    print("画像 %d 枚 / 曲 %d 曲 → 対応づけ %d 曲（うち更新 %d）" % (len(files), len(songs), len(assigned), changed))
    if rest:
        print("  △ 対応する曲が見つからなかった画像: " + ", ".join(rest))
    if left_songs:
        print("  △ 画像が見つからなかった曲: " + ", ".join("%s（%s）" % (s["title"], s["id"]) for s in left_songs))
    if args.dry_run:
        print("（--dry-run のため songs.json は書き換えていません）")
        return 0
    SONGS.write_text(format_songs_file(data), encoding="utf-8")
    print("songs.json を更新しました。python update.py check で確認できます。")
    return 0


def cmd_url(args):
    new = args.url.strip()
    if not new.startswith("https://"):
        print("https:// から始まるURLを指定してください。")
        return 1
    if not new.endswith("/"):
        new += "/"
    index = ROOT / "index.html"
    m = re.search(r'<link rel="canonical" href="([^"]+)"', index.read_text(encoding="utf-8"))
    if not m:
        print("index.html に canonical の指定が見つかりません。")
        return 1
    old = m.group(1)
    today = datetime.date.today().isoformat()
    for name in ("index.html", "sitemap.xml"):
        p = ROOT / name
        text = p.read_text(encoding="utf-8").replace(old, new)
        if name == "sitemap.xml":
            text = re.sub(r"<lastmod>.*?</lastmod>", "<lastmod>%s</lastmod>" % today, text)
        p.write_text(text, encoding="utf-8")
        print("更新:", name)
    print("%s → %s" % (old, new))
    return 0


def main():
    ap = argparse.ArgumentParser(description="songs.json の検査・追加・URL置換")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="songs.json を検査する").set_defaults(fn=cmd_check)
    a = sub.add_parser("add", help="曲を追加する")
    a.add_argument("--id", required=True)
    a.add_argument("--title", required=True)
    a.add_argument("--artist", required=True)
    a.add_argument("--arc", type=float, help="章の番号（Arc の曲のとき。--pack とは同時に使えません）")
    a.add_argument("--pack", help="パックのID（Arc に属さない曲のとき。先に add-pack で登録）")
    a.add_argument("--lv", required=True, nargs=4, type=int, metavar=("MIN", "EVO", "ULT", "FBD"))
    a.add_argument("--ja", default="")
    a.set_defaults(fn=cmd_add)
    ap_pack = sub.add_parser("add-pack", help="Arc 以外の新しいパックを登録する")
    ap_pack.add_argument("--id", required=True, help='パックID（半角英数とハイフン。例: virtual-singers）')
    ap_pack.add_argument("--label", required=True, help='画面に表示する名前（例: "Virtual Singers"）')
    ap_pack.set_defaults(fn=cmd_add_pack)
    j = sub.add_parser("jackets", help="jackets フォルダの画像を曲に自動で対応づける")
    j.add_argument("--dry-run", action="store_true", help="書き込まず、対応の結果だけ表示する")
    j.add_argument("--yes", action="store_true", help="消去法の対応を確認なしで採用する")
    j.add_argument("--noext", action="store_true", help='拡張子なしで書き込む（"Alterd_Edge" のように）')
    j.set_defaults(fn=cmd_jackets)
    u = sub.add_parser("url", help="公開URLを一括置換する")
    u.add_argument("url")
    u.set_defaults(fn=cmd_url)
    args = ap.parse_args()
    sys.exit(args.fn(args))


if __name__ == "__main__":
    main()
