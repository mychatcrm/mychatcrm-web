import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLabAudioRecorder } from "@/lib/agent-test-lab/audio-recorder";
import { LAB_MAX_UPLOAD_BYTES } from "@/lib/agent-test-lab/contracts";
let latest: FakeRecorder;
class FakeRecorder {
  static isTypeSupported = vi.fn(() => true);
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor() { latest = this; }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["recorded audio"]) }); this.onstop?.(); }
}
const callbacks = () => ({ file: vi.fn(), error: vi.fn(), stopped: vi.fn() });
const stopTrack = vi.fn(), getUserMedia = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); FakeRecorder.isTypeSupported.mockReturnValue(true);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("controlled microphone recording", () => {
  it("never requests a microphone until start and never requests a camera", async () => {
    const cb = callbacks(), recorder = createLabAudioRecorder(cb);
    expect(getUserMedia).not.toHaveBeenCalled(); await recorder.start();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false }); recorder.stop();
    expect(cb.file).toHaveBeenCalledOnce(); expect(stopTrack).toHaveBeenCalled();
    expect(cb.file.mock.calls[0][0].name).toBe("recording.webm");
  });
  it("automatically stops at sixty seconds", async () => {
    const cb = callbacks(), recorder = createLabAudioRecorder(cb); await recorder.start();
    await vi.advanceTimersByTimeAsync(59999); expect(cb.file).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(cb.file).toHaveBeenCalledOnce(); expect(stopTrack).toHaveBeenCalled();
  });
  it("discards audio and releases the microphone when leaving the panel", async () => {
    const cb = callbacks(), recorder = createLabAudioRecorder(cb); await recorder.start(); recorder.cancel();
    expect(cb.file).not.toHaveBeenCalled(); expect(stopTrack).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(61000); expect(cb.file).not.toHaveBeenCalled();
  });
  it("closes permission granted after unmount without starting recording", async () => {
    let grant!: (value: unknown) => void; getUserMedia.mockReturnValue(new Promise(resolve => { grant = resolve; }));
    const cb = callbacks(), recorder = createLabAudioRecorder(cb), start = recorder.start(); recorder.cancel();
    grant({ getTracks: () => [{ stop: stopTrack }] }); await start;
    expect(stopTrack).toHaveBeenCalled(); expect(cb.file).not.toHaveBeenCalled();
  });
  it("refuses bytes above the laboratory limit without uploading a partial file", async () => {
    const cb = callbacks(), recorder = createLabAudioRecorder(cb); await recorder.start();
    latest.ondataavailable?.({ data: new Blob([new Uint8Array(LAB_MAX_UPLOAD_BYTES + 1)]) });
    expect(cb.file).not.toHaveBeenCalled(); expect(cb.error).toHaveBeenCalledWith("recording_too_large");
  });
  it("shows a denied microphone as an error, not an empty successful recording", async () => {
    getUserMedia.mockRejectedValue(new Error("Permission denied")); const cb = callbacks(); await createLabAudioRecorder(cb).start();
    expect(cb.error).toHaveBeenCalledWith("microphone_unavailable"); expect(cb.file).not.toHaveBeenCalled();
  });
  it("does not request permission when no supported audio format exists", async () => {
    FakeRecorder.isTypeSupported.mockReturnValue(false); const cb = callbacks(); await createLabAudioRecorder(cb).start();
    expect(cb.error).toHaveBeenCalledWith("recording_unsupported"); expect(getUserMedia).not.toHaveBeenCalled();
  });
});
