/**
 * A MOCK Higgsfield MCP server for the ad-generator example — same tool shape as the real
 * connector, so the app + gate + consent flow are exactly what you'd run in production. It returns
 * real placeholder image URLs (picsum, seeded by the prompt) so the browser app shows actual
 * pictures. Swap this for the real Higgsfield MCP in ~/.relay/mcp.json and nothing else changes.
 *
 * generate_image is (correctly) classified WRITE by the daemon's default-deny policy — it spends
 * credits and is irreversible — so every call triggers a per-action consent.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHash } from "node:crypto";
import { z } from "zod";

const server = new McpServer({ name: "higgsfield", version: "0.0.1" });

server.registerTool(
  "generate_image",
  {
    description: "Generate an image from a text prompt, optionally guided by a reference image. Spends generation credits (irreversible).",
    inputSchema: {
      prompt: z.string().describe("Vivid visual description of the image"),
      aspect_ratio: z.enum(["1:1", "16:9", "9:16"]).optional(),
      reference: z.string().optional().describe("An optional reference image (data URL or asset id) to guide style/composition"),
    },
  },
  async ({ prompt, aspect_ratio, reference }) => {
    const seed = createHash("sha1").update(prompt + (reference ? "|ref:" + reference.slice(0, 24) : "")).digest("hex").slice(0, 12);
    const [w, h] = aspect_ratio === "9:16" ? [720, 1280] : aspect_ratio === "16:9" ? [1280, 720] : [1024, 1024];
    const url = `https://picsum.photos/seed/${seed}/${w}/${h}`;
    return { content: [{ type: "text", text: JSON.stringify({ url, prompt, aspect_ratio: aspect_ratio ?? "1:1", mode: reference ? "image-to-image" : "text-to-image", credits_spent: 5 }) }] };
  },
);

// generate_video — same shape as the real connector: animate a keyframe into a short clip. Also a
// WRITE (spends credits, irreversible), so the daemon gates each call with a per-action consent.
// Returns a real, playable sample clip URL (poster seeded by the prompt) so the reel flow completes.
server.registerTool(
  "generate_video",
  {
    description: "Animate a keyframe image into a short vertical video clip. Spends generation credits (irreversible).",
    inputSchema: {
      prompt: z.string().describe("Motion / scene description"),
      keyframe: z.string().optional().describe("Start-frame image URL or asset id"),
      aspect_ratio: z.enum(["1:1", "16:9", "9:16"]).optional(),
    },
  },
  async ({ prompt, keyframe, aspect_ratio }) => {
    const seed = createHash("sha1").update(prompt + (keyframe ? "|kf:" + keyframe.slice(0, 24) : "")).digest("hex").slice(0, 12);
    // A small, widely-mirrored sample clip stands in for a real render; poster is a seeded still.
    const url = "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";
    const poster = `https://picsum.photos/seed/${seed}/720/1280`;
    return { content: [{ type: "text", text: JSON.stringify({ url, poster, prompt, aspect_ratio: aspect_ratio ?? "9:16", duration_s: 6, credits_spent: 20 }) }] };
  },
);

await server.connect(new StdioServerTransport());
