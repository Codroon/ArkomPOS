/**
 * Photo slots — handoff/used-devices.md §1 "Photos".
 *
 * Every empty slot offers **Subir** and **Capturar** side by side, and that is
 * the whole point of the row: the shop may have a webcam on the counter or may
 * photograph on a phone and drag the file in, and neither should be the awkward
 * path. A machine with no camera is a calm state, not an error — the Capturar
 * button disables itself and says why, and Subir is untouched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AccentButton, GhostButton, SelectInput, cn, useT } from "@arkom/ui";
import { JPEG_QUALITY, MAX_EDGE_PX, slotKind, type DraftPhoto, type PhotoSlot } from "./model";

/* --------------------------------------------------------------- resizing */

/**
 * Down-scale to a JPEG the shop can actually store (W6).
 *
 * A modern phone camera produces 4–8MB per shot; five of those per purchase,
 * a few purchases a week, and the backup the shop carries home stops fitting on
 * the USB stick within a year. 1600px on the longest edge is still enough to
 * read a scratch or a document number.
 */
async function toJpegDataUrl(source: Blob | HTMLVideoElement): Promise<string> {
  const bitmap =
    source instanceof Blob ? await createImageBitmap(source) : await createImageBitmap(source);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

/* ---------------------------------------------------------- capture modal */

function CaptureModal({
  slotLabel,
  onCancel,
  onUse,
}: {
  slotLabel: string;
  onCancel: () => void;
  onUse: (dataUrl: string) => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  /**
   * Release the camera. Called on unmount, on Esc, and before every restart —
   * a webcam light left on after the modal closes reads, correctly, as the shop
   * being recorded.
   */
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (preferred?: string) => {
      stop();
      setStarting(true);
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: preferred ? { deviceId: { exact: preferred } } : true,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        // labels are only populated once permission has been granted, so the
        // picker is enumerated after the first successful open, never before
        const all = await navigator.mediaDevices.enumerateDevices();
        const cams = all.filter((d) => d.kind === "videoinput");
        setDevices(cams);
        const active = stream.getVideoTracks()[0]?.getSettings().deviceId ?? cams[0]?.deviceId ?? "";
        setDeviceId(active);
      } catch (err) {
        console.error("getUserMedia failed", err);
        setError(t("used.photos.cameraError"));
      } finally {
        setStarting(false);
      }
    },
    [stop, t],
  );

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stop();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, stop]);

  const capture = async () => {
    if (!videoRef.current) return;
    try {
      setShot(await toJpegDataUrl(videoRef.current));
    } catch (err) {
      console.error("capture failed", err);
      setError(t("used.photos.cameraError"));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
      <div className="w-[520px] rounded-[3px] border border-line-strong bg-card shadow-lg">
        <div className="flex items-center gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
          <div className="text-[13px] font-bold">{t("used.photos.captureTitle", { slot: slotLabel })}</div>
          <div className="flex-1" />
          <button
            type="button"
            className="text-[13px] text-muted hover:text-ink"
            onClick={() => {
              stop();
              onCancel();
            }}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="relative flex h-[300px] items-center justify-center overflow-hidden rounded-[3px] border border-line bg-inverse">
            {shot ? (
              <img src={shot} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <video ref={videoRef} muted playsInline className="max-h-full max-w-full object-contain" />
            )}
            {starting && !shot ? (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-inverse-muted">
                {t("used.photos.starting")}
              </div>
            ) : null}
          </div>

          {error ? <div className="mt-2 text-[11px] text-danger-ink">{error}</div> : null}

          {devices.length > 1 && !shot ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-muted">{t("used.photos.cameraLabel")}</span>
              <SelectInput
                className="flex-1"
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value);
                  void start(e.target.value);
                }}
              >
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `${t("used.photos.cameraLabel")} ${i + 1}`}
                  </option>
                ))}
              </SelectInput>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          {shot ? (
            <>
              <GhostButton onClick={() => setShot(null)}>{t("used.photos.retake")}</GhostButton>
              {/* the modal's one blue element */}
              <AccentButton
                onClick={() => {
                  stop();
                  onUse(shot);
                }}
              >
                {t("used.photos.use")}
              </AccentButton>
            </>
          ) : (
            <AccentButton disabled={starting || error !== null} onClick={() => void capture()}>
              {t("used.photos.shoot")}
            </AccentButton>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- slots */

export function PhotoSlotTile({
  slot,
  label,
  photo,
  hasCamera,
  onSet,
  onClear,
}: {
  slot: PhotoSlot;
  label: string;
  photo: DraftPhoto | undefined;
  hasCamera: boolean;
  onSet: (photo: DraftPhoto) => void;
  onClear: () => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onSet({ slot, kind: slotKind(slot), dataUrl: await toJpegDataUrl(file) });
    } catch (err) {
      console.error("photo import failed", err);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex w-[132px] flex-none flex-col gap-1">
      <div
        className={cn(
          "relative flex h-[132px] items-center justify-center overflow-hidden rounded-[3px] bg-card",
          photo ? "border border-line-strong" : "border border-dashed border-line-strong",
          busy && "opacity-60",
        )}
      >
        {photo ? (
          <>
            <img
              src={photo.dataUrl}
              alt={t("used.photos.slotFilled", { slot: label })}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={onClear}
              className="absolute inset-x-0 bottom-0 bg-inverse/85 py-1 text-[10px] text-inverse-ink opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
            >
              {t("used.photos.remove")}
            </button>
          </>
        ) : (
          <span className="px-2 text-center text-[10px] text-subtle">{label}</span>
        )}
      </div>

      {photo ? (
        <div className="truncate text-center text-[10px] text-subtle">{label}</div>
      ) : (
        <div className="flex gap-1">
          <GhostButton className="h-6 flex-1 px-0 text-[10px]" onClick={() => fileRef.current?.click()}>
            {t("used.photos.upload")}
          </GhostButton>
          <GhostButton
            className="h-6 flex-1 px-0 text-[10px]"
            disabled={!hasCamera}
            title={hasCamera ? undefined : t("used.photos.noCamera")}
            onClick={() => setCapturing(true)}
          >
            {t("used.photos.capture")}
          </GhostButton>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void takeFile(e.target.files?.[0])}
      />

      {capturing ? (
        <CaptureModal
          slotLabel={label}
          onCancel={() => setCapturing(false)}
          onUse={(dataUrl) => {
            onSet({ slot, kind: slotKind(slot), dataUrl });
            setCapturing(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Is there a camera at all?
 *
 * Enumerated once when the screen mounts. Before permission is granted the
 * labels are blank but the entries exist, which is all this needs to know —
 * and a shop with no webcam gets a disabled button with a reason rather than a
 * modal that opens onto a black rectangle.
 */
export function useHasCamera(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => {
        if (alive) setHas(all.some((d) => d.kind === "videoinput"));
      })
      .catch(() => {
        if (alive) setHas(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return has;
}
