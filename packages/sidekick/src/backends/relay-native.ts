import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Attachment } from "@relay/protocol";

/**
 * Relay-native tools exposed to the agentic loop — relay's OWN controlled primitives, not model
 * capabilities the origin has to be granted. Today: `put_blob`, the general "local file → remote
 * connector" bridge. The page attaches bytes (held daemon-side); the model runs a connector's own
 * upload flow (e.g. Higgsfield media_upload → presigned URL) and calls put_blob to PUT the bytes.
 * Solve this once and every upload-then-use connector works.
 *
 * SECURITY: these are auto-approved in the backend's canUseTool (they're relay primitives). The
 * blob is a file the USER attached this turn, and put_blob only sends it to an HTTPS URL the
 * connector just handed the model. [HARDEN LATER: restrict target URLs to known connector-storage
 * hosts, and cap size/count.]
 */
export function relayNativeServer(attachments: Map<string, Attachment>) {
  return createSdkMcpServer({
    name: "relay",
    version: "0.0.1",
    tools: [
      tool(
        "put_blob",
        "Upload a page-attached blob (by its relay handle) to a presigned upload URL via HTTP PUT. Use this to upload a user-attached reference image to a connector's upload_url (from e.g. media_upload). Returns { ok, status }.",
        { handle: z.string().describe("the attachment handle, e.g. 'ref'"), url: z.string().describe("the presigned upload URL"), method: z.string().optional(), contentType: z.string().optional() },
        async ({ handle, url, method, contentType }) => {
          const att = attachments.get(handle);
          if (!att) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `no attachment '${handle}'` }) }] };
          try {
            const bytes = dataUrlToBytes(att.dataUrl);
            const res = await fetch(url, { method: method || "PUT", body: bytes, headers: { "content-type": contentType || att.contentType } });
            return { content: [{ type: "text", text: JSON.stringify({ ok: res.ok, status: res.status }) }] };
          } catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err).slice(0, 160) }) }] };
          }
        },
      ),
    ],
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Uint8Array.from(Buffer.from(b64, "base64"));
}
