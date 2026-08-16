// Headless assertions for the launcher router. No app, no daemon, no model.
//   swiftc -parse-as-library LauncherRouting.swift LauncherRouting.test.swift -o /tmp/rt && /tmp/rt
// Exits non-zero on the first failing expectation, and prints one line per case so a red run says
// exactly WHICH sentence stopped routing.
import Foundation

private var failures = 0, checks = 0

private func expect(_ ok: Bool, _ what: String) {
    checks += 1
    if ok { print("  ✓ \(what)") } else { failures += 1; print("  ✗ \(what)") }
}

// A miniature catalog standing in for the real listings — the fields the router actually reads.
private let catalog: [SBRoute.Fields] = [
    .init(id: "resize", name: "Resize",
          keywords: ["smaller", "shrink", "compress", "image size", "scale down", "webp", "jpeg", "png"],
          tagline: "Resize, convert and compress images on your device",
          inside: ["canvas pipeline"], commands: ["resize_image · resize an image to a target width"]),
    .init(id: "pdftools", name: "PDF Tools",
          keywords: ["merge", "split", "rotate", "combine", "pages"],
          tagline: "Merge, split and rotate PDFs",
          inside: ["pdf-lib"], commands: ["merge_pdf · merge several PDFs into one"]),
    .init(id: "palette", name: "Palette",
          keywords: ["colours", "colors", "swatches", "extract", "dominant colour"],
          tagline: "Pull a colour palette out of any image"),
    .init(id: "convert", name: "Convert",
          keywords: ["csv", "json", "yaml", "reshape", "table"],
          tagline: "Convert data between CSV, JSON and YAML"),
    .init(id: "prism", name: "Prism",
          keywords: ["generate image", "illustration", "art"],
          tagline: "Make images from a prompt"),
    .init(id: "qr", name: "QR", keywords: ["qr code", "barcode", "scan"],
          tagline: "Generate a QR code"),
    .init(id: "hn", name: "Hacker News", keywords: ["news", "trending", "tech"],
          tagline: "What's on the front page", commands: ["top_stories · fetch trending tech stories"]),
]

/// The one call the launcher makes: rank the catalog for a query.
private func rank(_ q: String) -> [String] {
    var scored: [(id: String, s: Int)] = []
    for f in catalog {
        let s = SBRoute.score(q, f)
        if s > 0 { scored.append((f.id, s)) }
    }
    scored.sort { a, b in a.s == b.s ? a.id < b.id : a.s > b.s }
    return scored.map { $0.id }
}

private func top(_ q: String) -> String? { rank(q).first }

@main struct RouterTests {
    static func main() {
        print("\n── typed intent ─────────────────────────────────────────")
        // The load-bearing case: none of these sentences contain the word "resize".
        expect(top("make this image smaller") == "resize", "\"make this image smaller\" → resize")
        expect(top("shrink my screenshot") == "resize", "\"shrink my screenshot\" → resize")
        expect(top("compress a png") == "resize", "\"compress a png\" → resize")
        // Plural / gerund forms have to survive the stemmer.
        expect(rank("resizing images").first == "resize", "\"resizing images\" → resize (stemmed)")
        // Typing the actual name always wins outright.
        expect(top("prism") == "prism", "\"prism\" → prism (exact name beats every tagline mention)")
        expect(top("palette") == "palette", "\"palette\" → palette")
        // Intent that only the keywords carry.
        expect(top("merge two pdfs") == "pdftools", "\"merge two pdfs\" → pdftools")
        expect(top("combine pages") == "pdftools", "\"combine pages\" → pdftools")
        expect(top("get the colours out of this photo") == "palette", "\"get the colours out of this photo\" → palette")
        expect(top("csv to json") == "convert", "\"csv to json\" → convert")
        // The third-party lane keeps working through the SAME scorer (it used to have its own).
        expect(top("find me trending tech news") == "hn", "\"find me trending tech news\" → hn (capability text)")
        // Honest misses: nonsense must rank nothing rather than rank everything.
        expect(rank("zzzqqq").isEmpty, "gibberish matches nothing")
        expect(rank("the a of to").isEmpty, "an all-stopword query matches nothing")
        expect(SBRoute.score("", catalog[0]) == 0, "empty query scores 0")

        print("\n── file kinds ───────────────────────────────────────────")
        expect(SBRoute.kind(forPath: "/tmp/shot.PNG") == .image, "shot.PNG → image (case-insensitive)")
        expect(SBRoute.kind(forPath: "/tmp/invoice.pdf") == .pdf, "invoice.pdf → pdf")
        expect(SBRoute.kind(forPath: "/tmp/rows.csv") == .data, "rows.csv → data")
        expect(SBRoute.kind(forPath: "/tmp/notes.md") == .text, "notes.md → text")
        expect(SBRoute.kind(forPath: "/tmp/take.mov") == .video, "take.mov → video")
        expect(SBRoute.kind(forPath: "/tmp/Makefile") == .other, "an extensionless file → other (never crashes)")
        expect(SBRoute.kind(forPath: "") == .other, "an empty path → other")

        print("\n── file → which tools ───────────────────────────────────")
        // The whole point: a dropped PDF must NOT light up the image tools.
        expect(SBRoute.accepts(id: "pdftools", declared: nil, kind: .pdf), "pdf → pdftools ✓")
        expect(!SBRoute.accepts(id: "resize", declared: nil, kind: .pdf), "pdf → resize ✗")
        expect(!SBRoute.accepts(id: "palette", declared: nil, kind: .pdf), "pdf → palette ✗")
        expect(SBRoute.accepts(id: "resize", declared: nil, kind: .image), "image → resize ✓")
        expect(SBRoute.accepts(id: "palette", declared: nil, kind: .image), "image → palette ✓")
        expect(!SBRoute.accepts(id: "pdftools", declared: nil, kind: .image), "image → pdftools ✗")
        expect(SBRoute.accepts(id: "convert", declared: nil, kind: .data), "csv → convert ✓")
        expect(SBRoute.accepts(id: "god", declared: nil, kind: .video), "God takes anything ✓")
        // An unknown listing with no manifest declaration claims nothing — silence, not a false ring.
        expect(!SBRoute.accepts(id: "nameit", declared: nil, kind: .image), "an undeclared wrapp claims nothing")

        print("\n── manifest `accepts` overrides the built-in table ───────")
        expect(SBRoute.accepts(id: "whatever", declared: ["image"], kind: .image), "bare kind \"image\"")
        expect(SBRoute.accepts(id: "whatever", declared: ["image/*"], kind: .image), "glob \"image/*\"")
        expect(SBRoute.accepts(id: "whatever", declared: [".pdf"], kind: .pdf), "extension \".pdf\"")
        expect(SBRoute.accepts(id: "whatever", declared: ["csv", "json"], kind: .data), "extension list → data")
        expect(SBRoute.accepts(id: "whatever", declared: ["*"], kind: .archive), "\"*\" takes everything")
        expect(!SBRoute.accepts(id: "whatever", declared: ["image"], kind: .pdf), "a declared list EXCLUDES the rest")
        // A manifest declaration must beat the built-in table, not merge with it.
        expect(!SBRoute.accepts(id: "resize", declared: ["pdf"], kind: .image),
               "a manifest `accepts` REPLACES the default (resize:[pdf] no longer takes images)")
        expect(SBRoute.takesAnyFile(id: "resize", declared: nil), "resize takes files (default table)")
        expect(!SBRoute.takesAnyFile(id: "nameit", declared: nil), "nameit takes no files")
        expect(SBRoute.takesAnyFile(id: "nameit", declared: ["image"]), "…until its manifest says so")

        print("\n\(checks - failures)/\(checks) passed" + (failures == 0 ? " ✓\n" : "  — \(failures) FAILED\n"))
        exit(failures == 0 ? 0 : 1)
    }
}
