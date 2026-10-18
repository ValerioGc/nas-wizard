// Languages of the interface.
export type Locale = 'it' | 'en';

// Translation branches contain either text or nested groups of texts.
export interface TranslationCatalog {
  [key: string]: string | TranslationCatalog;
}

export type Theme = 'system' | 'light' | 'dark';

// The tone of an alert (determines icon and color).
export type AlertTone = 'info' | 'success' | 'warning' | 'error';

// A wireless network in reach, as the wizard lists it.
export interface WizardNetwork {
  ssid: string;
  signal: number;
  security: string;
  known: boolean;
}

// What the wizard reads of the network: where the NAS is connected, and what it can join.
export interface WizardNetworks {
  connection: { kind: 'lan' | 'wifi'; connected: boolean; ssid: string | null };
  wifi: WizardNetwork[];
  canConnect: boolean;
  wifiNote: 'noDevice' | 'noNetworkManager' | 'unavailable' | null;
}

// Current wizard step
export type Phase = 'collecting' | 'installing' | 'ready' | 'done' | 'failed';

// The steps of the installation, in the order the wizard runs them.
export type StepId =
  | 'download_gateway'
  | 'download_ui'
  | 'install_gateway'
  | 'install_ui'
  | 'configure'
  | 'disks'
  | 'account'
  | 'certificate'
  | 'complete'
  | 'handover';

export interface InstallStep {
  id: StepId;
  state: 'pending' | 'running' | 'done' | 'failed';
  detail: string;
}

// Wizard state
export interface WizardState {
  phase: Phase;
  steps: InstallStep[];
  simulated: boolean;
  version: string;
}

// How a repository the wizard downloads from answered a token.
export interface RepositoryAccess {
  repository: string;
  access: 'ok' | 'refused' | 'forbidden' | 'missing' | 'unreachable';
}

// What the page sends once the choices are made. No token reads public releases only.
export interface Configuration {
  username: string;
  password: string;
  language: Locale;
  theme: Theme;
  nasName: string;
  token?: string;
  disks?: DiskChoice[];
}

// A data disk the wizard lists
export interface WizardDisk {
  device: string;
  size: number;
  model: string | null;
  identity: string;
  empty: boolean;
}

// The step of the data disks, which the wizard may have off.
export interface WizardDisks {
  enabled: boolean;
  encryption: boolean;
  disks: WizardDisk[];
}

// What becomes of an empty disk
export type DiskPlan = 'keep' | 'plain' | 'encrypted';

// An empty disk to initialize, as the page sends it.
export interface DiskChoice {
  device: string;
  identity: string;
  encrypt: boolean;
}

// What the end of the installation offers to download: the authority of the NAS for HTTPS.
export interface CertificateOffer {
  caPem: string | null;
}
