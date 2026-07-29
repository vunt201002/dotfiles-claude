#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Create/append an Obsidian note in the Joy vault with correct frontmatter & location.

Usage:
  python note.py add --title "..." --type how-it-works --domain "Referral" [opts]
  python note.py list            # show valid domains / areas
  python note.py add ... --dry-run

Body text: pass via --body "..." or pipe on stdin. If the note already exists,
a dated section is appended (unless --new, which makes a "(2)" copy).
"""
import argparse, os, re, sys, datetime

# Vault location: env override, else default to this repo's joy-vault.
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
DEFAULT_VAULT = os.path.join(SCRIPT_DIR, "..", "..", "..", "joy-vault")
VAULT = os.path.abspath(os.environ.get("JOY_VAULT", DEFAULT_VAULT))

TYPES = ["how-it-works", "gotcha", "potential-bug", "decision", "bug", "confusion", "raw"]
ALWAYS_AREAS = ["Confusion", "Facing", "Handoffs", "Initiatives", "Insights", "Tasks", "Technical"]
RESERVED = {"00-Index", "Templates", "Domains"}

# Keyword hints for auto-detecting the target domain/area from note text.
# Keys must match real folder names (domains under Domains/, or top-level areas).
KEYWORDS = {
    "Points Economy": ["point", "điểm", "diem", "earn", "redeem", "balance", "tiêu điểm",
                       "cộng điểm", "trừ point", "expire", "point expiration", "miscalc"],
    "Rewards": ["reward", "phần thưởng", "đổi thưởng", "free gift", "gift", "voucher",
                "coupon", "discount code", "quà"],
    "Referral": ["referral", "giới thiệu", "refer", "affiliate", "tapaffiliate", "invite",
                 "share code", "anti-cheat", "dual reward"],
    "VIP Tiers": ["vip", "tier", "hạng", "milestone", "tier reset", "lên hạng", "xuống hạng"],
    "Storefront Widget": ["widget", "storefront", "theme", "liquid", "web component", "lit",
                          "scripttag", "script tag", "v4", "launcher", "popup", "css", "swym"],
    "Subscription": ["subscription", "sub ", "aftercharge", "recurring", "charge", "billing plan"],
    "Integrations": ["klaviyo", "shopify flow", "okendo", "integration", "tích hợp", "3rd party",
                     "zapier", "typdal", "tinselrack", "sync", "metafield"],
    "Notifications": ["email", "notification", "thông báo", "webhook", "push", "mail"],
    "Customer Profiles": ["customer", "khách hàng", "profile", "hồ sơ", "customer list", "segment"],
    "Merchant Ops": ["merchant", "admin", "polaris", "onboarding", "vận hành", "settings page",
                     "merchant dashboard"],
    "Analytics": ["analytics", "dashboard", "metric", "report", "số liệu", "thống kê", "event tracking"],
    "Programs": ["program", "chương trình", "loyalty program", "campaign", "perks"],
    "Social": ["social", "mạng xã hội", "facebook", "instagram", "tiktok"],
    # areas
    "Technical": ["endpoint", "wallet pass", "apple wallet", "lifecycle", "data contract",
                  "topology", "architecture", "service", "api ", "auth endpoint", "app-data.liquid"],
}

def detect_domain(text):
    """Return (best_name, score, ranked_list) by keyword hits; best=None if no hit."""
    t = (text or "").lower()
    valid = set(domains()) | set(areas())
    scores = {}
    for name, kws in KEYWORDS.items():
        if name not in valid:
            continue
        s = sum(1 for kw in kws if kw.lower() in t)
        if s:
            scores[name] = s
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    return (ranked[0][0] if ranked else None), (ranked[0][1] if ranked else 0), ranked

# Which app a note is about. "shared" = applies to both.
PRODUCTS = ["wishlist", "loyalty", "shared"]
PRODUCT_KEYWORDS = {
    "wishlist": ["wishlist", "guest wishlist", "variant button", "share token", "save for later",
                 "joy-wishlist", "avada_wishlist", "wishlistrepository", "add to wishlist"],
    "loyalty": ["loyalty", "point", "điểm", "tier", "vip", "reward", "redeem", "earn",
                "referral", "affiliate", "perks", "milestone", "store credit", "wallet pass",
                "program", "joy widget v4", "__joydebug"],
}
def detect_product(text):
    t = (text or "").lower()
    sc = {p: sum(1 for kw in kws if kw in t) for p, kws in PRODUCT_KEYWORDS.items()}
    sc = {p: n for p, n in sc.items() if n}
    if not sc:
        return None
    return max(sc.items(), key=lambda kv: kv[1])[0]

def today():
    return datetime.date.today().isoformat()

def domains():
    d = os.path.join(VAULT, "Domains")
    return sorted([n for n in os.listdir(d) if os.path.isdir(os.path.join(d, n))]) if os.path.isdir(d) else []

def areas():
    out = []
    for n in os.listdir(VAULT):
        p = os.path.join(VAULT, n)
        if os.path.isdir(p) and n not in RESERVED and not n.startswith("."):
            out.append(n)
    return sorted(out)

def slug_filename(title):
    name = re.sub(r'[\\/:*?"<>|]', "-", title).strip()
    return name[:120] or "untitled"

def fuzzy(target, options):
    if not target:
        return None
    t = target.strip().lower()
    for o in options:                       # exact (ci)
        if o.lower() == t:
            return o
    for o in options:                       # contains
        if t in o.lower() or o.lower() in t:
            return o
    # token overlap
    tt = set(re.split(r"\W+", t))
    best, score = None, 0
    for o in options:
        s = len(tt & set(re.split(r"\W+", o.lower())))
        if s > score:
            best, score = o, s
    return best

def resolve_folder(ntype, domain):
    if ntype == "bug":
        base = os.path.join("Technical", "Bugs")
    elif ntype == "confusion":
        base = "Confusion"
    else:
        match = fuzzy(domain, domains())
        if match:
            base = os.path.join("Domains", match)
        else:
            area = fuzzy(domain, areas())
            base = area if area else "Inbox"   # unclassified quick captures
    if ntype == "raw":
        base = os.path.join(base, "raw")
    return base

def build_frontmatter(ntype, status, severity, product):
    fm = ["---", f"type: {ntype}"]
    if product:
        fm.append(f"product: {product}")
    if ntype == "potential-bug":
        fm.append(f"severity: {severity or 'medium'}")
        fm.append(f"status: {status or 'open'}")
    elif ntype == "bug":
        fm.append(f"severity: {severity or 'medium'}")
        fm.append(f"status: {status or 'investigating'}")
    elif status:
        fm.append(f"status: {status}")
    fm.append(f"created: {today()}")
    fm.append(f"updated: {today()}")
    tags = "[joy" + (f", {product}" if product else "") + "]"
    fm.append(f"tags: {tags}")
    fm.append("---")
    return "\n".join(fm)

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    ap_list = sub.add_parser("list")
    ap_det = sub.add_parser("detect")
    ap_det.add_argument("text", nargs="*")
    a = sub.add_parser("add")
    a.add_argument("--title", required=True)
    a.add_argument("--type", default="how-it-works", choices=TYPES)
    a.add_argument("--domain", default="")
    a.add_argument("--product", "-p", default="")   # wishlist | loyalty | shared | auto
    a.add_argument("--severity", default="")
    a.add_argument("--status", default="")
    a.add_argument("--body", default=None)
    a.add_argument("--links", default="")   # comma-separated note/domain names
    a.add_argument("--new", action="store_true", help="force new file even if exists")
    a.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(VAULT):
        sys.exit(f"Vault not found: {VAULT} (set JOY_VAULT)")

    if args.cmd == "list":
        print("Domains:", ", ".join(domains()))
        print("Areas:  ", ", ".join(areas()))
        print("Types:  ", ", ".join(TYPES))
        return

    if args.cmd == "detect":
        text = " ".join(args.text) or (sys.stdin.read() if not sys.stdin.isatty() else "")
        best, score, ranked = detect_domain(text)
        print("domain:", best, f"(score {score})" if best else "(no keyword hit)")
        if ranked:
            print("  ranked:", ", ".join(f"{n}={s}" for n, s in ranked))
        print("product:", detect_product(text) or "(unknown)")
        return

    body = args.body
    if body is None:
        body = sys.stdin.read() if not sys.stdin.isatty() else ""
    body = (body or "").strip()

    # auto-detect domain when not given (or --domain auto)
    if args.type not in ("bug", "confusion") and (not args.domain or args.domain.lower() == "auto"):
        best, score, _ = detect_domain(args.title + " " + body)
        if best:
            print(f"[auto] domain = {best} (score {score})")
            args.domain = best
        else:
            print("[auto] no keyword match -> Inbox (chỉnh --domain nếu cần)")
            args.domain = ""

    # auto-detect product (app) when not given (or --product auto)
    if not args.product or args.product.lower() == "auto":
        p = detect_product(args.title + " " + body)
        if p:
            print(f"[auto] product = {p}")
            args.product = p
        else:
            print("[auto] product chưa rõ -> để trống (chỉnh -p wishlist|loyalty|shared nếu cần)")
            args.product = ""

    rel = resolve_folder(args.type, args.domain)
    folder = os.path.join(VAULT, rel)
    fname = slug_filename(args.title) + ".md"
    path = os.path.join(folder, fname)

    # links footer
    link_md = ""
    if args.links.strip():
        items = [x.strip() for x in args.links.split(",") if x.strip()]
        link_md = "\n\nLiên quan: " + " ".join(f"[[{x}]]" for x in items)

    if args.dry_run:
        print(f"[dry-run] -> {os.path.relpath(path, VAULT)}")
        print(f"  type={args.type} folder={rel}")
        return

    os.makedirs(folder, exist_ok=True)

    if os.path.exists(path) and not args.new:
        # append a dated section + bump `updated`
        with open(path, "r", encoding="utf-8") as f:
            cur = f.read()
        cur = re.sub(r"(?m)^updated:.*$", f"updated: {today()}", cur, count=1)
        add = f"\n\n---\n_Cập nhật {today()}_\n\n{body}{link_md}\n"
        with open(path, "w", encoding="utf-8") as f:
            f.write(cur.rstrip() + "\n" + add)
        print(f"APPENDED -> {os.path.relpath(path, VAULT)}")
        return

    if os.path.exists(path) and args.new:
        i = 2
        while os.path.exists(os.path.join(folder, slug_filename(args.title) + f" ({i}).md")):
            i += 1
        path = os.path.join(folder, slug_filename(args.title) + f" ({i}).md")

    content = f"{build_frontmatter(args.type, args.status, args.severity, args.product)}\n# {args.title}\n\n{body}{link_md}\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"CREATED -> {os.path.relpath(path, VAULT)}")

if __name__ == "__main__":
    main()
