import notifier from "node-notifier";

export function notify(title: string, message: string): void {
  try {
    notifier.notify({
      title,
      message,
      sound: true,
      timeout: 10,
    });
  } catch {
    // Ignore unsupported notification environments.
  }
}
