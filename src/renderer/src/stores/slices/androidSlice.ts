import type { StateCreator } from 'zustand';
import type { ZeusState } from '../types';
import type {
  AndroidDeviceInfo,
  LogcatEntry,
  AndroidViewNode,
} from '../../../../shared/types';
import { zeusWs } from '@/lib/ws';

export interface AndroidSlice {
  // State
  androidRunning: boolean;
  androidDevices: AndroidDeviceInfo[];
  androidAvds: string[];
  androidScreenshot: string | null;
  androidViewHierarchy: AndroidViewNode[] | null;
  androidLogcat: LogcatEntry[];

  // Actions
  startAndroidEmulator: (avdName?: string) => void;
  stopAndroidEmulator: () => void;
  listAndroidDevices: () => void;
  takeAndroidScreenshot: () => void;
  getAndroidViewHierarchy: () => void;
  installAndroidApk: (apkPath: string) => void;
  launchAndroidApp: (appId: string) => void;
  clearAndroidLogcat: () => void;
}

export const createAndroidSlice: StateCreator<ZeusState, [], [], AndroidSlice> = (set) => ({
  androidRunning: false,
  androidDevices: [],
  androidAvds: [],
  androidScreenshot: null,
  androidViewHierarchy: null,
  androidLogcat: [],

  startAndroidEmulator: (avdName?: string) => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'start_emulator', avdName },
    });
  },

  stopAndroidEmulator: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'stop_emulator' },
    });
  },

  listAndroidDevices: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'list_devices' },
    });
  },

  takeAndroidScreenshot: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'screenshot' },
    });
  },

  getAndroidViewHierarchy: () => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'view_hierarchy' },
    });
  },

  installAndroidApk: (apkPath: string) => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'install_apk', apkPath },
    });
  },

  launchAndroidApp: (appId: string) => {
    zeusWs.send({
      channel: 'android', sessionId: '', auth: '',
      payload: { type: 'launch_app', appId },
    });
  },

  clearAndroidLogcat: () => {
    set({ androidLogcat: [] });
  },
});
