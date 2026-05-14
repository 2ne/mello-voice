import { Image } from '@tauri-apps/api/image';
import { join, resourceDir } from '@tauri-apps/api/path';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow, type Theme } from '@tauri-apps/api/window';

type IconTheme = 'light' | 'dark';

async function iconPath(theme: IconTheme, size = 32) {
  return join(await resourceDir(), 'icons', 'runtime', `mello-voice-${theme}-${size}.png`);
}

async function applyIconTheme(theme: IconTheme) {
  const icon = await Image.fromPath(await iconPath(theme, 32));

  await getCurrentWindow().setIcon(icon);

  const tray = await TrayIcon.getById('main');
  await tray?.setIcon(icon);
}

function toIconTheme(theme: Theme | null): IconTheme {
  return theme === 'dark' ? 'dark' : 'light';
}

export async function setupThemeAwareIcons() {
  const win = getCurrentWindow();

  await applyIconTheme(toIconTheme(await win.theme()));

  return win.onThemeChanged(async ({ payload }) => {
    await applyIconTheme(toIconTheme(payload));
  });
}
