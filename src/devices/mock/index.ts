import { DeviceInfoData, LiveData, SettingsData } from 'interfaces/data';
import {
  ConnectOptions,
  Device,
  DeviceCallbacks,
  DeviceIdentificator,
  DeviceStatus,
  DisconnectReasons,
} from 'interfaces/device';
import { wait } from 'utils/index';

export const DEMO_MODE =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');

const CELL_COUNT = 20;
const FRAME_INTERVAL = 400;
const NOMINAL_CAPACITY = 40;

const noise = (amount: number) => (Math.random() - 0.5) * 2 * amount;

/**
 * Fake BMS for trying out the UI without hardware. Enabled with `?demo` in the URL.
 * Simulates a ride: acceleration, cruising, braking and a slowly draining pack.
 */
export class MockBMS implements Device {
  status: DeviceStatus = 'disconnected';
  deviceIdenticator: DeviceIdentificator | null = null;
  callbacks: DeviceCallbacks;
  cache = {};
  decoder = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private lastFrameAt = 0;
  private remainingCapacity = NOMINAL_CAPACITY * 0.82;
  private settings = { charge: true, discharge: true };
  private cellOffsets = Array.from({ length: CELL_COUNT }, () => noise(0.004));
  // Internal resistance per cell in ohms (~1.2 - 2.4 mOhm)
  private cellResistances = Array.from({ length: CELL_COUNT }, () => 0.0018 + noise(0.0006));

  constructor(callbacks: DeviceCallbacks) {
    this.callbacks = callbacks;
  }

  private setStatus(status: DeviceStatus) {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  async connect(_options: ConnectOptions = {}): Promise<DeviceIdentificator | null> {
    this.setStatus('scanning');
    await wait(500);
    this.setStatus('connecting');
    await wait(700);

    this.deviceIdenticator = { id: 'demo', name: 'JK-DEMO' };
    this.setStatus('connected');
    this.callbacks.onConnected?.(this.deviceIdenticator);

    const now = Date.now();
    this.callbacks.onDataReceived('DEVICE_INFO', {
      timestamp: now,
      timeSinceLastOne: 0,
      id: 'demo',
      name: 'JK-DEMO',
      firmwareVersion: 'demo',
    } as DeviceInfoData);
    this.emitSettings();

    this.startedAt = now;
    this.lastFrameAt = now;
    this.timer = setInterval(() => this.emitLiveData(), FRAME_INTERVAL);
    this.emitLiveData();

    return this.deviceIdenticator;
  }

  async disconnect(reason: DisconnectReasons): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.deviceIdenticator = null;
    this.setStatus('disconnected');
    this.callbacks.onDisconnected?.(reason);
  }

  async pause(): Promise<void> {
    //
  }

  async toggleCharging(value: boolean): Promise<void> {
    this.settings.charge = value;
    await wait(300);
    this.emitSettings();
  }

  async toggleDischarging(value: boolean): Promise<void> {
    this.settings.discharge = value;
    await wait(300);
    this.emitSettings();
  }

  private emitSettings() {
    this.callbacks.onDataReceived('SETTINGS', {
      timestamp: Date.now(),
      timeSinceLastOne: 0,
      ...this.settings,
      ovp: 3.65,
      uvp: 2.8,
      uvpr: 3,
      cellCount: CELL_COUNT,
      capacity: NOMINAL_CAPACITY,
      ocp: 60,
      cocp: 30,
    } as unknown as SettingsData);
  }

  private emitLiveData() {
    const now = Date.now();
    const t = (now - this.startedAt) / 1000;

    // 60s loop: accelerate -> cruise -> brake -> stop
    const phase = t % 60;
    const speed =
      phase < 12
        ? (phase / 12) * 45
        : phase < 40
        ? 45 + Math.sin(phase) * 4
        : phase < 52
        ? 45 * (1 - (phase - 40) / 12)
        : 0;
    const current = this.settings.discharge
      ? Math.max(0, 1.5 + (speed / 45) * 22 + (phase < 12 ? 14 : 0) + noise(1.2))
      : 0;

    const dtHours = (now - this.lastFrameAt) / 3_600_000;
    this.lastFrameAt = now;
    this.remainingCapacity = Math.max(1, this.remainingCapacity - current * dtHours);
    const percentage = Math.round((this.remainingCapacity / NOMINAL_CAPACITY) * 100);

    const restCell = 3.2 + (percentage / 100) * 0.9;
    const voltages = this.cellOffsets.map(
      (offset, i) => +(restCell - current * this.cellResistances[i] + offset).toFixed(4)
    );
    const voltage = voltages.reduce((sum, v) => sum + v, 0);
    const min = Math.min(...voltages);
    const max = Math.max(...voltages);

    const data = {
      timestamp: now,
      timeSinceLastOne: FRAME_INTERVAL + Math.round(noise(40)),
      cellCount: CELL_COUNT,
      voltage,
      nominalVoltage: 72,
      current,
      power: voltage * current,
      voltages,
      averageCellVoltage: voltage / CELL_COUNT,
      minVoltage: min,
      maxVoltage: max,
      cellVoltageDelta: max - min,
      remainingCapacity: this.remainingCapacity,
      nominalCapacity: NOMINAL_CAPACITY,
      percentage,
      cycleCount: 42,
      balanceCurrent: max - min > 0.008 ? 0.4 : 0,
      resistances: voltages.map(() => 0.9 + Math.random() * 0.3),
      temperatureProbes: [28 + current * 0.35 + noise(0.3), 26 + current * 0.2 + noise(0.3)],
    } as unknown as LiveData;

    this.callbacks.onDataReceived('LIVE_DATA', data);
  }
}
