import { describe, it, expect, vi, afterEach } from 'vitest';
import { Camera } from '../../src/camera/camera';

function fakeStream() {
  const stop = vi.fn();
  return { stop, stream: { getTracks: () => [{ stop }], getVideoTracks: () => [{ stop }] } as unknown as MediaStream };
}
function fakeVideo() {
  return { srcObject: null, muted: false, setAttribute: () => {}, play: () => Promise.resolve() } as unknown as HTMLVideoElement;
}

afterEach(() => vi.unstubAllGlobals());

describe('Camera', () => {
  it('start twice stops the first stream; stop twice does not throw', async () => {
    const a = fakeStream();
    const b = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValueOnce(a.stream).mockResolvedValueOnce(b.stream);
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const cam = new Camera();
    const video = fakeVideo();
    await cam.start(video);
    await cam.start(video);
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(b.stop).not.toHaveBeenCalled();
    cam.stop();
    expect(b.stop).toHaveBeenCalledTimes(1);
    expect(() => cam.stop()).not.toThrow();
  });
});
