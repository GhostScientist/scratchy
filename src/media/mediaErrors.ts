export function friendlyMediaError(err: unknown, device: 'camera' | 'microphone'): string {
  const name = err instanceof DOMException ? err.name : '';
  const Device = device === 'camera' ? 'Camera' : 'Microphone';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `${Device} access was denied. Allow the ${device} in your browser's site settings, then try again.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${device} was found on this device.`;
    case 'NotReadableError':
    case 'AbortError':
      return `The ${device} appears to be in use by another app. Close it and try again.`;
    default:
      return `Couldn't start the ${device}. Check your browser permissions and try again.`;
  }
}
