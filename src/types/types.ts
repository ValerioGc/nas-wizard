/**
 * Types of the wizard.
 */

/** Languages of the interface. */
export type Locale = 'it' | 'en';

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
  wifiNote: string | null;
}

// Where the wizard is: collecting the choices, installing, ready (the certificates are offered and
// the handover waits for the person), done, or stopped on a failed step.
export type Phase = 'collecting' | 'installing' | 'ready' | 'done' | 'failed';

// The steps of the installation, in the order the wizard runs them.
export type StepId =
  | 'download_gateway'
  | 'download_ui'
  | 'install_gateway'
  | 'install_ui'
  | 'configure'
  | 'account'
  | 'certificate'
  | 'complete'
  | 'handover';

export interface InstallStep {
  id: StepId;
  state: 'pending' | 'running' | 'done' | 'failed';
  detail: string;
}

// What the wizard says of itself: never the password, never the token.
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
}

// What the end of the installation offers to download: the authority of the NAS for HTTPS.
// Empty in a simulation.
export interface CertificateOffer {
  caPem: string | null;
}
