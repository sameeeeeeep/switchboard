// LAUNCHER ROUTING — the deterministic "what did you mean / what is this file for" resolver.
//
// Two questions the ⌥⌥ launcher has to answer with NO model, in microseconds, every keystroke:
//
//   1. the user TYPED something  →  which apps/tools does that mean?      (`SBRoute.score`)
//   2. the user DROPPED a file   →  which tools can actually take it?     (`SBRoute.kind` + `.accepts`)
//
// Before this, (1) was a substring test on name+tagline — so "make this image smaller" matched nothing,
// because no listing contains the word "smaller". And (2) was a hardcoded id allowlist with no notion of
// file TYPE — dropping a .pdf ringed the image tools exactly as brightly as the PDF one.
//
// This module is deliberately PURE (Foundation only, no AppKit/SwiftUI, no app-module types) so it can be
// compiled and unit-tested headless:
//     swiftc -parse-as-library LauncherRouting.swift LauncherRouting.test.swift -o /tmp/rt && /tmp/rt
// That's the same discipline as god.mjs' router.test.mjs (docs/FAST-ROUTING.md): the routing grammar gets
// real assertions, not a vibe check in a running app.
import Foundation

enum SBRoute {

    // ───────────────────────────── 1 · TYPED INTENT ─────────────────────────────

    /// Words that carry no intent. Dropping them stops "get me a" scoring against every listing that
    /// happens to contain "get". Mirrors (and extends) the list the third-party lane already used.
    static let stopWords: Set<String> = [
        "find", "me", "a", "an", "the", "for", "to", "of", "on", "in", "get", "show", "what", "whats",
        "is", "my", "give", "and", "how", "do", "i", "can", "you", "please", "some", "latest", "about",
        "with", "this", "that", "it", "into", "from", "make", "want", "need", "help", "just", "any",
    ]

    /// Split a raw query into meaningful, lowercased tokens.
    static func tokens(_ query: String) -> [String] {
        query.lowercased()
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
            .filter { $0.count > 1 && !stopWords.contains($0) }
    }

    /// Crude English stem — enough to bridge "images"→"image", "resizing"→"resiz", "converter"→"convert".
    /// Not a real stemmer and doesn't pretend to be; it only has to make the common plural/gerund forms
    /// of tool vocabulary collide with the listing text.
    static func stem(_ t: String) -> String {
        var s = t
        for suffix in ["ing", "ers", "er", "es", "s"] where s.count > suffix.count + 2 && s.hasSuffix(suffix) {
            s = String(s.dropLast(suffix.count)); break
        }
        return s
    }

    /// Does `haystack` (already lowercased) contain this token, or its stem?
    private static func hit(_ haystack: String, _ token: String) -> Bool {
        if haystack.contains(token) { return true }
        let s = stem(token)
        return s.count > 2 && s != token && haystack.contains(s)
    }

    /// The searchable material a listing offers, in descending order of how much a match means.
    struct Fields {
        let id: String
        let name: String
        var keywords: [String] = []   // manifest `keywords` — the synonyms a name can't carry
        var tagline: String = ""
        var inside: [String] = []     // manifest `inside` — what's in the box
        var commands: [String] = []   // the God-callable command names + descriptions (the capability)
        init(id: String, name: String, keywords: [String] = [], tagline: String = "",
             inside: [String] = [], commands: [String] = []) {
            self.id = id; self.name = name; self.keywords = keywords
            self.tagline = tagline; self.inside = inside; self.commands = commands
        }
    }

    /// Score how well a listing answers a typed query. 0 = no match (caller drops it).
    ///
    /// Weighted rather than a flat token count so "prism" ranks Prism above every listing whose tagline
    /// merely mentions prisms, and so a manifest `keywords` entry ("smaller", "shrink", "compress") is
    /// nearly as strong a signal as the name itself — keywords are the whole point of the field.
    static func score(_ query: String, _ f: Fields) -> Int {
        let toks = tokens(query)
        guard !toks.isEmpty else { return 0 }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let name = f.name.lowercased(), id = f.id.lowercased()

        // Whole-query exact hits short-circuit to the top — typing a tool's actual name must always win.
        var total = 0
        if q == name || q == id { total += 100 }
        else if name.hasPrefix(q) || id.hasPrefix(q) { total += 40 }

        let kw = f.keywords.map { $0.lowercased() }
        let tagline = f.tagline.lowercased()
        let rest = (f.inside + f.commands).joined(separator: " ").lowercased()

        for t in toks {
            if hit(name, t) { total += 12 }
            // A keyword matches in EITHER direction: query "shrink" ↔ keyword "shrink image", and
            // query "compression" ↔ keyword "compress" (via the stem).
            if kw.contains(where: { hit($0, t) || hit(t, $0) }) { total += 10 }
            if hit(tagline, t) { total += 4 }
            if hit(rest, t) { total += 2 }
        }
        return total
    }

    // ───────────────────────────── 2 · DROPPED FILE ─────────────────────────────

    /// The coarse buckets a launcher actually routes on. Deliberately few: a tool declares "I take
    /// images", never "I take image/x-portable-pixmap".
    enum Kind: String, CaseIterable {
        // `vector` is split out of `image` deliberately: an SVG optimiser must NOT light up for a dropped
        // PNG, and a raster tracer must not light up for an SVG. Kinds are coarse, but where the coarseness
        // would make a tool ring for a file it can't actually handle, the kind splits.
        case image, vector, pdf, data, text, audio, video, archive, font, code, other

        /// What the intake bar says the staged thing is.
        var label: String {
            switch self {
            case .image: return "image";   case .vector: return "vector"; case .pdf: return "PDF"
            case .data: return "data";     case .text: return "text";     case .audio: return "audio"
            case .video: return "video";   case .archive: return "archive"; case .font: return "font"
            case .code: return "code";     case .other: return "file"
            }
        }
    }

    private static let extensions: [Kind: Set<String>] = [
        .image: ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tiff", "tif", "bmp", "avif", "ico"],
        .vector: ["svg", "eps", "ai"],
        .pdf: ["pdf"],
        .data: ["csv", "tsv", "json", "yaml", "yml", "xml", "ndjson", "parquet", "xlsx", "xls"],
        .text: ["txt", "md", "markdown", "rtf", "docx", "doc", "odt", "epub", "tex"],
        .audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "aiff", "caf"],
        .video: ["mp4", "mov", "webm", "mkv", "avi", "m4v"],
        .archive: ["zip", "tar", "gz", "tgz", "7z", "rar"],
        .font: ["ttf", "otf", "woff", "woff2"],
        .code: ["js", "ts", "tsx", "jsx", "swift", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "sh", "html", "css"],
    ]

    /// Classify a file by extension. Extension-only on purpose: it's synchronous, allocation-free and
    /// never touches disk, so it can run on every drag-hover frame. A wrong guess degrades to `.other`,
    /// which no tool claims exclusively — it never blocks the user, it just stops ranking.
    static func kind(forPath path: String) -> Kind {
        let ext = (path as NSString).pathExtension.lowercased()
        guard !ext.isEmpty else { return .other }
        for (k, exts) in extensions where exts.contains(ext) { return k }
        return .other
    }

    /// The built-in fallback: which of today's wrapps take a file, and which KINDS.
    ///
    /// This is the founder's existing allowlist (`fileTakerIds`) with the missing half — the file type —
    /// finally attached. It stays as a fallback only: a listing that declares `accepts` in its
    /// switchboard.json overrides this entirely, so new tools never need a Swift edit.
    static let defaultAccepts: [String: Set<Kind>] = [
        "god": Set(Kind.allCases),                   // God takes anything as its turn reference
        "pdftools": [.pdf],
        "convert": [.data, .text],
        "palette": [.image],
        "prism": [.image],
        "resize": [.image],
        "qr": [.text, .data],
    ]

    /// Does this listing accept a file of `kind`?
    ///
    /// `declared` is the manifest's `accepts` array. It understands three spellings so a manifest can be
    /// written the obvious way: a bare kind (`"image"`), a MIME-ish glob (`"image/*"`), or an extension
    /// (`".pdf"` / `"pdf"`). `"*"` / `"any"` means everything.
    static func accepts(id: String, declared: [String]?, kind k: Kind) -> Bool {
        if let d = declared, !d.isEmpty {
            for raw in d {
                let s = raw.lowercased().trimmingCharacters(in: .whitespaces)
                if s == "*" || s == "any" || s == "*/*" { return true }
                if s == k.rawValue { return true }                                  // "image"
                if s.hasSuffix("/*"), String(s.dropLast(2)) == k.rawValue { return true }  // "image/*"
                let ext = s.hasPrefix(".") ? String(s.dropFirst()) : s              // ".pdf" / "pdf"
                if extensions[k]?.contains(ext) == true { return true }
            }
            return false
        }
        return defaultAccepts[id]?.contains(k) ?? false
    }

    /// Does this listing take a file at all (any kind)? Used for the "no file staged yet" affordance.
    static func takesAnyFile(id: String, declared: [String]?) -> Bool {
        if let d = declared, !d.isEmpty { return true }
        return defaultAccepts[id] != nil
    }
}
