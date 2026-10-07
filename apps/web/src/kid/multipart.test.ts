import { describe, expect, it } from "vitest";
import { readCappedFormData } from "./multipart";

function multipartBody(boundary: string): Uint8Array {
  const encoder = new TextEncoder();
  return new Uint8Array([
    ...encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\nhello`),
    ...encoder.encode(`\r\n--${boundary}--\r\n`),
  ]);
}

/** Strumień, który liczy dostarczone bajty — dowód zachowania limitu buforowania. */
function countingSource(chunks: Uint8Array[]) {
  let index = 0;
  let delivered = 0;
  return {
    deliveredBytes: () => delivered,
    stream: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        delivered += chunks[index]!.byteLength;
        controller.enqueue(chunks[index]!);
        index += 1;
      },
    }),
  };
}

function postRequest(body: ReadableStream<Uint8Array> | Uint8Array, boundary: string): Request {
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: body as unknown as BodyInit,
  };
  if (body instanceof ReadableStream) {
    init.duplex = "half";
  }
  return new Request("http://localhost/api/v1/kid/tasks/t/attempts", init);
}

describe("readCappedFormData — limit buforowania przed analizą (arch §11)", () => {
  it("przepuszcza mały formularz i zwraca pola", async () => {
    const boundary = "znacznik";
    const form = await readCappedFormData(postRequest(multipartBody(boundary), boundary), 1024);
    expect(form.get("a")).toBe("hello");
  });

  it("odrzuca przekraczający limit strumień błędem walidacji", async () => {
    const boundary = "znacznik";
    const head = multipartBody(boundary);
    const tail1 = new Uint8Array(64 * 1024);
    const tail2 = new Uint8Array(64 * 1024);
    const source = countingSource([head, tail1, tail2]);
    await expect(readCappedFormData(postRequest(source.stream, boundary), 1024)).rejects.toMatchObject({
      code: "validation",
    });
    // nadmiarowy strumień dokończono z porzuceniem danych — bez zrywania gniazda
    expect(source.deliveredBytes()).toBe(head.byteLength + tail1.byteLength + tail2.byteLength);
  });
});
