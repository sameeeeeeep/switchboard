// AMBIENT MODE UI (in-app port of AmbientCanvas.preview.swift). When Switchboard notices — strictly
// locally (AmbientSensor) — that you're on something a project/wrapp can help with, a small HELPER CANVAS
// grows from the notch offering 1–3 contextual actions, in the SAME command-center grammar as God's notch
// pills/widgets (NotchDropShape silhouette, Color.page, single lime accent). Tokens/shape/Color live in
// RelayMenuBar.swift; AmbientSuggestion lives in AmbientSensor.swift — this file is the views only.
import AppKit
import SwiftUI

// Ambient stays NARROW so it keeps the notch silhouette as content grows — a tall drop, never a wide banner.
// Tokens sourced from the module-level SB/SBr scales (RelayMenuBar.swift) — one grid, one radius scale.
private enum AmbT {
    static let s2 = SB.s2, s3 = SB.s3, s4 = SB.s4
    static let rSm = SBr.xs, rMd = SBr.sm
    static let ear: CGFloat = 14, hair: CGFloat = 1
    static let width: CGFloat = 340
}

/// A per-kind tag pill (wrapp / skill / widget) — muted, so the eye still lands on the lime action tile.
struct KindTag: View {
    let kind: String
    var body: some View {
        Text(kind).font(.splMono(9)).kerning(0.6).foregroundColor(.inkFaint)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(Color.raised))
            .overlay(Capsule().stroke(Color.edge, lineWidth: AmbT.hair))
    }
}

/// One tappable suggestion: lime-tinted SF-Symbol tile + title/subtitle + kind tag + chevron.
struct AmbientRow: View {
    let s: AmbientSuggestion
    var onPick: (String) -> Void
    var body: some View {
        Button(action: { onPick(s.targetId) }) {
            HStack(spacing: AmbT.s3) {
                ZStack {
                    RoundedRectangle(cornerRadius: AmbT.rSm).fill(Color.lime.opacity(0.14))
                    Image(systemName: s.sfSymbol).font(.system(size: 15, weight: .semibold)).foregroundColor(.lime)
                }.frame(width: 34, height: 34)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(s.title).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
                        KindTag(kind: s.kind)
                    }
                    Text(s.subtitle).font(.hanken(11)).foregroundColor(.inkDim).lineLimit(1)
                }
                Spacer(minLength: AmbT.s2)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundColor(.inkFaint)
            }
            .padding(.horizontal, AmbT.s3).padding(.vertical, AmbT.s2 + 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: AmbT.rMd).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: AmbT.rMd).stroke(Color.edge, lineWidth: AmbT.hair))
        }.buttonStyle(.plain)
    }
}

/// The helper drop — shared notch chrome × 1–3 suggestion rows. Grows vertically inside a fixed narrow
/// width so it always reads as an extended notch, never a wide banner.
struct AmbientCanvas: View {
    let context: String                         // "LinkedIn" / "Preview" / app name
    let suggestions: [AmbientSuggestion]         // sensor supplies 1–3 (we render at most 3)
    var onPick: (String) -> Void = { _ in }
    var onDismiss: () -> Void = {}
    private var shown: [AmbientSuggestion] { Array(suggestions.prefix(3)) }
    var body: some View {
        VStack(alignment: .leading, spacing: AmbT.s3) {
            HStack(alignment: .center, spacing: AmbT.s2) {
                Circle().fill(Color.lime).frame(width: 6, height: 6)   // a lime dot on black is already bright — no static halo (NOTCH-DESIGN §5)
                Text("AMBIENT · \(context.uppercased())")
                    .font(.splMono(9.5)).kerning(1.4).foregroundColor(.inkFaint).lineLimit(1)
                Spacer(minLength: AmbT.s2)
                Button(action: onDismiss) {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).foregroundColor(.inkDim)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(Color.panel)).overlay(Circle().stroke(Color.edge, lineWidth: AmbT.hair))
                }.buttonStyle(.plain)
            }
            VStack(spacing: AmbT.s2) {
                ForEach(shown) { AmbientRow(s: $0, onPick: onPick) }
            }
        }
        .padding(.top, AmbT.s4).padding(.horizontal, AmbT.ear + AmbT.s3).padding(.bottom, AmbT.s4 + 2)
        .frame(width: AmbT.width, alignment: .leading)
        .background(Color.page)
        .clipShape(NotchDropShape(ear: AmbT.ear, botR: 22))
        .overlay(NotchDropShape(ear: AmbT.ear, botR: 22).stroke(Color.edge.opacity(0.5), lineWidth: AmbT.hair))
        .ignoresSafeArea()
    }
}

/// The idle resting presence: ambient on, nothing surfaced. A tiny lime-cored ring in a minimal notch stub.
struct AmbientDot: View {
    var body: some View {
        HStack(spacing: 6) {
            ZStack {
                Circle().stroke(Color.lime.opacity(0.45), lineWidth: 1.5).frame(width: 12, height: 12)
                Circle().fill(Color.lime).frame(width: 5, height: 5)   // resting lamp — no static glow (NOTCH-DESIGN §5)
            }
            Text("watching").font(.splMono(9)).kerning(0.5).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 8)
        .frame(minWidth: 96)
        .background(Color.page)
        .clipShape(NotchDropShape(ear: 10, botR: 12))
        .overlay(NotchDropShape(ear: 10, botR: 12).stroke(Color.edge.opacity(0.5), lineWidth: AmbT.hair))
        .ignoresSafeArea()
    }
}

/// Full-screen honesty flash for a local-only ambient screenshot. Distinct INDIGO (#5B8DEF / Color.localInk),
/// NOT the normal lime capture flash → "never left your Mac". Inset rounded border + a caption chip.
struct LocalCaptureBorder: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 26)
                .strokeBorder(Color.localInk, lineWidth: 4)
                .shadow(color: Color.localInk.opacity(0.5), radius: 10)
                .padding(10)
            VStack {
                Spacer()
                HStack {
                    HStack(spacing: 6) {
                        Image(systemName: "lock.laptopcomputer").font(.system(size: 11, weight: .semibold))
                        Text("local only · never left your Mac").font(.splMono(10)).kerning(0.4)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Capsule().fill(Color.localInk.opacity(0.92)))
                    .overlay(Capsule().stroke(Color.white.opacity(0.25), lineWidth: AmbT.hair))
                    .shadow(color: Color.localInk.opacity(0.45), radius: 8)
                    Spacer()
                }
                .padding(.leading, 34).padding(.bottom, 30)
            }
        }
    }
}
