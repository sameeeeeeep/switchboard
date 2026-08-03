import AppKit
import SwiftUI

// ════════════════════════ the store FRONT PAGE ════════════════════════
// App-Store-style FEATURED page — the one page you see before all apps. Ported from
// StoreFront.preview.swift onto the live catalog: two 2-up hero cards, "Apps we love right now"
// (4 non-skill listings, 2-col), "New skills" (6 skill listings, 2-col, "Free · runs on your
// Claude"). House tokens throughout; 724×476 to sit in the exact footprint of the classic
// StoreView modal. Chrome is STICKY: the top bar is pinned, everything else scrolls between.
// "See All" (and the Apps/Skills tab pills) hand off to the classic full StoreView via onSeeAll.

struct StoreFrontView: View {
    let listings: [SBListing]                        // the live catalog
    var icon: (String) -> NSImage? = { _ in nil }    // per-wrapp icon by id (nil → category glyph tile)
    var onGet: (SBListing) -> Void = { _ in }
    var onSeeAll: (String) -> Void = { _ in }        // → the classic full StoreView, preselecting a filter ("apps"/"skill"/"All")
    var onClose: () -> Void = {}

    // Layout tokens, scaled from the 880pt preview down to the 724pt modal.
    private enum M {
        static let pad: CGFloat = 24; static let gap: CGFloat = 24
        static let rCard: CGFloat = 16; static let rIcon: CGFloat = 13
    }

    // ---- content picks (the rules, not a CMS) ----
    // Heroes: prefer "roast" + "flow" when the catalog has them, else the first two listings.
    private var heroes: [SBListing] {
        var picks: [SBListing] = []
        for id in ["roast", "flow"] {
            if let l = listings.first(where: { $0.id == id }) { picks.append(l) }
        }
        for l in listings where picks.count < 2 {
            if !picks.contains(where: { $0.id == l.id }) { picks.append(l) }
        }
        return picks
    }
    // "Apps we love" = 4 non-skill listings — skip the heroes so the front page never repeats
    // itself, unless the catalog is too thin to afford that.
    private var loved: [SBListing] {
        let heroIds = Set(heroes.map(\.id))
        var pool = listings.filter { $0.category != "skill" && !heroIds.contains($0.id) }
        if pool.count < 4 { pool = listings.filter { $0.category != "skill" } }
        return Array(pool.prefix(4))
    }
    private var skills: [SBListing] { Array(listings.filter { $0.category == "skill" }.prefix(6)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            topBar                                   // pinned — never scrolls
            if listings.isEmpty {
                emptyState
            } else {
                ScrollView(showsIndicators: false) { scrollBody }
            }
        }
        .frame(width: 724, height: 476, alignment: .top)
        .background(RoundedRectangle(cornerRadius: 20).fill(Color.page))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    // The scrollable page under the pinned bar. Internal (not private) so a snapshot harness can
    // render it directly — ScrollView content doesn't lay out inside ImageRenderer.
    var scrollBody: some View {
        VStack(alignment: .leading, spacing: M.gap) {
            heroRow
            if !loved.isEmpty { gridSection("Apps we love right now", loved, free: false, filter: "apps") }
            if !skills.isEmpty { gridSection("New skills", skills, free: true, filter: "skill") }
        }
        .padding(.horizontal, M.pad).padding(.top, 18).padding(.bottom, 28)
    }

    // ---- sticky top bar: wordmark · Featured/Apps/Skills pills · close ----
    private var topBar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 6).fill(Color.lime).frame(width: 20, height: 20)
                        .overlay(Circle().fill(Color.page).frame(width: 6, height: 6).offset(x: 5.5, y: -5.5))
                    Text("Switchboard").font(.brico(16, .bold)).foregroundColor(.ink)
                }
                Spacer(minLength: 16)
                HStack(spacing: 4) {
                    tabPill("Featured", active: true) {}
                    tabPill("Apps", active: false) { onSeeAll("apps") }
                    tabPill("Skills", active: false) { onSeeAll("skill") }
                }
                Spacer(minLength: 16)
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundColor(.inkDim)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(Color.panel))
                        .overlay(Circle().stroke(Color.edge, lineWidth: 1))
                }.buttonStyle(.plain)
            }
            .padding(.horizontal, M.pad).padding(.vertical, 13)
            Rectangle().fill(Color.edge).frame(height: 1)
        }
        .background(Color.page)
    }

    private func tabPill(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.hanken(12, active ? .semibold : .medium))
                .foregroundColor(active ? .page : .inkDim)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Capsule().fill(active ? Color.lime : Color.clear))
        }.buttonStyle(.plain)
    }

    // ---- the 2-up hero row ----
    private var heroRow: some View {
        HStack(spacing: 14) {
            ForEach(Array(heroes.enumerated()), id: \.element.id) { i, l in
                heroCard(l, eyebrow: i == 0 ? "APPS WE LOVE" : "GET STARTED")
            }
        }
    }

    private func heroCard(_ l: SBListing, eyebrow: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 7) {
                Text(eyebrow).kicker()
                Text(l.name).font(.brico(20, .bold)).foregroundColor(.ink)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Text(l.tagline).font(.hanken(12)).foregroundColor(.inkDim)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Button(action: { onGet(l) }) {
                    Text("Get").font(.hanken(12, .semibold)).foregroundColor(.page)
                        .padding(.horizontal, 16).padding(.vertical, 6)
                        .background(Capsule().fill(Color.lime))
                }.buttonStyle(.plain)
            }
            Spacer(minLength: 0)
            heroArt(l)
        }
        .padding(16).frame(maxWidth: .infinity).frame(height: 168, alignment: .top)
        .background(RoundedRectangle(cornerRadius: M.rCard).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: M.rCard).stroke(Color.edge, lineWidth: 1))
    }

    @ViewBuilder private func heroArt(_ l: SBListing) -> some View {
        if let img = icon(l.id) {
            Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
                .frame(width: 92, height: 92)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.edge, lineWidth: 1))
        } else {
            ZStack {
                Circle().fill(LinearGradient(colors: [catTint(l.category).opacity(0.9), catTint(l.category).opacity(0.45)],
                                             startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: catGlyph(l.category)).font(.system(size: 30, weight: .semibold))
                    .foregroundColor(.white.opacity(0.92))
            }.frame(width: 92, height: 92)
        }
    }

    // ---- a titled 2-col grid section (header gets the lime See All) ----
    private func gridSection(_ title: String, _ rows: [SBListing], free: Bool, filter: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.brico(17, .bold)).foregroundColor(.ink)
                Spacer()
                Button(action: { onSeeAll(filter) }) {
                    Text("See All").font(.hanken(12, .semibold)).foregroundColor(.lime)
                }.buttonStyle(.plain)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 24), GridItem(.flexible(), spacing: 24)],
                      alignment: .leading, spacing: 2) {
                ForEach(rows) { l in appRow(l, free: free) }
            }
        }
    }

    // ---- one app row: icon tile · name · tagline · Get ----
    private func appRow(_ l: SBListing, free: Bool) -> some View {
        HStack(spacing: 11) {
            iconTile(l, 46)
            VStack(alignment: .leading, spacing: 2) {
                Text(l.name).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
                Text(l.tagline).font(.hanken(11)).foregroundColor(.inkDim).lineLimit(1)
                if free { Text("Free · runs on your Claude").font(.splMono(8.5)).foregroundColor(.inkFaint) }
            }
            Spacer(minLength: 8)
            Button(action: { onGet(l) }) {
                Text("Get").font(.hanken(11.5, .semibold)).foregroundColor(.ink)
                    .padding(.horizontal, 14).padding(.vertical, 6)
                    .background(Capsule().fill(Color.raised))
                    .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
            }.buttonStyle(.plain)
        }.padding(.vertical, 6)
    }

    @ViewBuilder private func iconTile(_ l: SBListing, _ size: CGFloat) -> some View {
        if let img = icon(l.id) {
            Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: M.rIcon))
                .overlay(RoundedRectangle(cornerRadius: M.rIcon).stroke(Color.edge, lineWidth: 1))
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: M.rIcon)
                    .fill(LinearGradient(colors: [catTint(l.category).opacity(0.85), catTint(l.category).opacity(0.4)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: catGlyph(l.category)).font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundColor(.white.opacity(0.95))
            }.frame(width: size, height: size)
        }
    }

    // ---- no catalog yet — keep the fixed footprint, hand off to the classic store's guidance ----
    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.grid.2x2").font(.system(size: 26)).foregroundColor(.inkFaint)
            Text("No catalog yet").font(.hanken(13, .semibold)).foregroundColor(.ink)
            Button(action: { onSeeAll("All") }) {
                Text("Open the full store").font(.hanken(12, .semibold)).foregroundColor(.page)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 9).fill(Color.lime))
            }.buttonStyle(.plain)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
