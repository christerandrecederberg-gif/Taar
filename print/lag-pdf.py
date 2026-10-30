"""Lager Taar-sjekkliste.pdf (A4 liggende, én side per liste) fra sjekkliste.md."""
import html, pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
SRC, HTML, PDF = HERE / "sjekkliste.md", HERE / "sjekkliste-print.html", HERE / "Taar-sjekkliste.pdf"
COLUMNS = ["Date"] * 7
LEGEND = "✓ = completed &nbsp;|&nbsp; N/A = not applicable &nbsp;|&nbsp; If not completed, write a short reason directly in that day's cell"
PAGE_MM = 189  # usable height on A4 landscape with the margins below


def parse(text):
    pages = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("## "):
            pages.append({"title": line[3:], "sub": "", "initials": "Initials", "rows": []})
        elif not pages:
            continue
        elif line.startswith("Undertittel:"):
            pages[-1]["sub"] = line.split(":", 1)[1].strip()
        elif line.startswith("Initialer:"):
            pages[-1]["initials"] = line.split(":", 1)[1].strip()
        elif line.startswith("### "):
            pages[-1]["rows"].append(("section", line[4:]))
        elif line.startswith("- "):
            pages[-1]["rows"].append(("item", line[2:]))
    return pages


def render(pages):
    n = 0
    body = []
    for p in pages:
        items = sum(1 for k, _ in p["rows"] if k == "item")
        sections = len(p["rows"]) - items
        # Give the writing rows as much height as the page allows, between 5 and 8 mm.
        row_mm = max(5.0, min(8.0, (PAGE_MM - 24 - 5.5 - 8 - sections * 5.2) / max(items, 1)))
        rows, zebra = [], 0
        for kind, text in p["rows"]:
            if kind == "section":
                zebra = 0
                rows.append(f'<tr class="sec"><td colspan="{2 + len(COLUMNS)}">{html.escape(text.upper())}</td></tr>')
                continue
            n += 1
            cls = ' class="z"' if zebra % 2 else ""
            zebra += 1
            rows.append(f'<tr{cls} style="height:{row_mm:.2f}mm"><td class="n">{n}</td><td class="t">{html.escape(text)}</td>' + "<td></td>" * len(COLUMNS) + "</tr>")
        head = "".join(f"<th>{c}</th>" for c in COLUMNS)
        body.append(f"""<section class="page"><h1>TÅR &nbsp;|&nbsp; {html.escape(p['title'])}</h1>
<p class="sub"><b>{html.escape(p['sub'])}</b></p><p class="leg">{LEGEND}</p>
<table><thead><tr><th class="n">#</th><th class="t">Task</th>{head}</tr></thead>
<tbody><tr class="ini"><td colspan="2">{html.escape(p['initials'])}</td>{'<td></td>' * len(COLUMNS)}</tr>{''.join(rows)}</tbody></table>
<div class="foot">TÅR</div></section>""")
    css = """@page{size:A4 landscape;margin:10mm 11mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0}
.page{break-after:page;position:relative;height:189mm}.page:last-child{break-after:auto}
h1{font-size:15pt;margin:0 0 1mm}.sub{font-size:8pt;margin:0}.leg{font-size:7pt;color:#555;margin:.5mm 0 2mm}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8pt}
th,td{border:.5pt solid #b5b5b5;padding:0 3pt;vertical-align:middle}
th{background:#d4d4d4;font-size:7pt;height:5.5mm}th.n,td.n{width:7mm;text-align:center}th.t,td.t{width:130mm;text-align:left}
tr.z td{background:#e6e6e6}tr.sec td{background:#c4c4c4;font-weight:bold;font-size:7pt;height:5.2mm}
tr.ini td{background:#f2f2f2;font-weight:bold;font-size:7pt;height:8mm}
.foot{position:absolute;right:0;bottom:0;font-size:6.5pt;color:#888;font-weight:bold}"""
    return f'<!doctype html><meta charset="utf-8"><title>Tår sjekkliste</title><style>{css}</style>{"".join(body)}'


def main():
    HTML.write_text(render(parse(SRC.read_text(encoding="utf-8"))), encoding="utf-8")
    pw = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip() + "/playwright/index.mjs"
    js = f"""import {{ chromium }} from '{pw}';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto('file://{HTML}'); await p.pdf({{ path: '{PDF}', preferCSSPageSize: true, printBackground: true }}); await b.close();"""
    subprocess.run(["node", "--input-type=module", "-e", js], check=True)
    print(f"Lagret {PDF}")


if __name__ == "__main__":
    sys.exit(main())
