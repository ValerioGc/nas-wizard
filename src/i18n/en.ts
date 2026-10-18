// Wizard texts grouped by step, with shared controls in common.
export default {
  common: {
    back: 'Back',
    close: 'Close',
    next: 'Next',
    retry: 'Retry',
    loading: 'Loading',
    configurationLoading: 'Reading the state of the configuration',
    requestFailed: 'Operation failed. The NAS did not answer.',
    stepOf: 'Step {step} of {total}',
    password: {
      hide: 'Hide password',
      show: 'Show password',
    },
    alerts: {
      info: 'Information',
      success: 'Successful operation',
      warning: 'Warning',
      error: 'Error',
    },
  },
  welcome: {
    title: 'First configuration',
    intro:
      'The NAS is not configured yet. The initial configuration has to be completed before it can be used.',
    configure: 'Configure',
  },
  account: {
    title: 'Administrator account',
    intro: 'The administrator account used to sign in to the NAS and manage its settings.',
    fields: {
      username: 'Username',
      password: 'Password',
      confirmPassword: 'Password confirmation',
    },
    validation: {
      required: 'Entering {field} is required.',
      length: 'Between {min} and {max} characters are required.',
      username: 'the username',
      password: 'the password',
      usernameCharacters:
        'The name starts with a letter or an underscore and contains letters, numbers, dots, hyphens or underscores.',
      usernameUnavailable: 'Name reserved by the operating system.',
      passwordMismatch: 'The two passwords do not match.',
    },
  },
  appearance: {
    title: 'Name, language and theme',
    intro:
      'Network name of the NAS, language and theme of the interface. All values can be changed later in the settings.',
    name: {
      label: 'Name of the NAS',
      invalid:
        'Up to 63 characters among letters, numbers and hyphens, without a leading or trailing hyphen.',
    },
    language: {
      label: 'Language',
      options: {
        it: 'Italiano',
        en: 'English',
      },
    },
    theme: {
      label: 'Theme',
      options: {
        system: 'System',
        light: 'Light',
        dark: 'Dark',
      },
    },
  },
  network: {
    title: 'Network connection',
    intro:
      'Connection of the NAS to the local network, wired or Wi-Fi. With the cable plugged in, Wi-Fi is optional.',
    connectedTo: 'Connected to {name}',
    wiredConnection: 'wired network',
    password: 'Network password',
    noNetworks: 'No Wi-Fi network found',
    scan: 'Scan networks',
    scanning: 'Looking for networks',
    security: 'Security',
    fixed:
      'Network management not available in this installation, the current connection stays active.',
    connect: 'Connect',
    connecting: 'Connecting',
    wifiNote: {
      noDevice: 'No Wi-Fi network card found',
      noNetworkManager: 'Wi-Fi management unavailable on the NAS',
      unavailable: 'Wi-Fi network list unavailable',
    },
  },
  disks: {
    title: 'Data disks',
    intro:
      'Empty disks to prepare for data. Disks with data stay as they are and appear in Files. This step is optional.',
    none: 'No empty data disk is connected.',
    inUse: 'Already holds data: it stays as it is',
    options: {
      keep: 'Leave as it is',
      plain: 'Initialize',
      encrypted: 'Initialize encrypted',
    },
    warning: 'Initializing a disk erases all of its content.',
    encryptedNote:
      'An encrypted disk unlocks by itself at startup. After signing in, set a password and a recovery key in the Disks app.',
  },
  token: {
    title: 'Release token',
    intro:
      'GitHub token used to download gateway and launcher and, later, the private releases of the launcher and of the applications. The saved token cannot be displayed.',
    field: 'Token',
    invalid: 'The token cannot contain spaces.',
    check: 'Check',
    emptyNote: 'Without a token only public releases can be downloaded.',
    set: 'Set',
    notSet: 'None',
    access: {
      ok: 'Readable',
      refused: 'Token refused',
      forbidden: 'Missing permissions',
      missing: 'No release or repository not visible',
      unreachable: 'Unreachable',
    },
  },
  summary: {
    title: 'Summary',
    intro: 'A summary of the choices made, to be confirmed to complete the configuration.',
    connection: 'Connection',
    noConnection: 'Not connected',
    passwordSet: 'Set',
    complete: 'Complete',
    installNote:
      'At the end gateway and launcher are installed, the token, the account and the terminal user are saved, then the interface of the NAS opens.',
    failed: 'Configuration not started ({reason}).',
    disks: {
      label: 'Disks to initialize',
      none: 'None',
      encrypted: 'encrypted',
    },
  },
  install: {
    title: 'Installing the NAS',
    intro:
      'Installing and configuring the NAS. This can take a few minutes and the page updates automatically.',
    simulated: 'Simulated configuration, nothing installed.',
    handover: 'Opening the interface of the NAS',
    steps: {
      downloadGateway: 'Downloading the gateway',
      downloadUi: 'Downloading the launcher',
      installGateway: 'Installing the gateway',
      installUi: 'Installing the launcher',
      configure: 'Token, user of the terminal and data disks',
      disks: 'Initialization of the data disks',
      account: 'Account of the NAS',
      certificate: 'HTTPS authority of the NAS',
      complete: 'Language and theme of the launcher',
      handover: 'Starting the gateway',
    },
    states: {
      pending: 'Waiting',
      done: 'Done',
      failed: 'Failed',
    },
  },
  certificate: {
    title: 'HTTPS certificate of the NAS',
    loading: 'Reading the certificate',
    simulated: 'Simulated configuration, no certificate available.',
    authority: {
      title: 'Authority of the NAS',
      note: 'The NAS is reachable over HTTPS with a certificate signed by this authority. Installing the authority as trusted in the system or in the browser avoids the insecure connection warning.',
      download: 'Download the certificate of the authority',
    },
    goToLogin: 'Go to sign-in',
  },
} as const;
