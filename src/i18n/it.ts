// Wizard texts grouped by step, with shared controls in common.
export default {
  common: {
    back: 'Indietro',
    close: 'Chiudi',
    next: 'Avanti',
    retry: 'Riprova',
    loading: 'Caricamento in corso',
    configurationLoading: 'Lettura dello stato della configurazione',
    requestFailed: 'Operazione non riuscita. Il NAS non ha risposto.',
    stepOf: 'Passo {step} di {total}',
    password: {
      hide: 'Nascondi password',
      show: 'Mostra password',
    },
    alerts: {
      info: 'Informazione',
      success: 'Operazione riuscita',
      warning: 'Avviso',
      error: 'Errore',
    },
  },
  welcome: {
    title: 'Configurazione iniziale',
    intro:
      'Il NAS non è ancora configurato. Per iniziare a usarlo è necessario completare la configurazione iniziale.',
    configure: 'Configura',
  },
  account: {
    title: 'Account amministratore',
    intro: 'Account amministratore con cui si accede al NAS e se ne gestiscono le impostazioni.',
    fields: {
      username: 'Nome utente',
      password: 'Password',
      confirmPassword: 'Conferma della password',
    },
    validation: {
      required: 'È necessario inserire {field}.',
      length: 'Sono richiesti da {min} a {max} caratteri.',
      username: 'il nome utente',
      password: 'la password',
      usernameCharacters:
        'Il nome inizia con una lettera o un trattino basso e contiene lettere, numeri, punti, trattini o trattini bassi.',
      usernameUnavailable: 'Nome riservato dal sistema operativo.',
      passwordMismatch: 'Le due password non coincidono.',
    },
  },
  appearance: {
    title: 'Nome, lingua e tema',
    intro:
      'Nome del NAS in rete, lingua e tema dell’interfaccia. Tutti i valori sono modificabili in seguito dalle impostazioni.',
    name: {
      label: 'Nome del NAS',
      invalid:
        'Fino a 63 caratteri tra lettere, numeri e trattini, senza trattino iniziale o finale.',
    },
    language: {
      label: 'Lingua',
      options: {
        it: 'Italiano',
        en: 'English',
      },
    },
    theme: {
      label: 'Tema',
      options: {
        system: 'Sistema',
        light: 'Chiaro',
        dark: 'Scuro',
      },
    },
  },
  network: {
    title: 'Connessione di rete',
    intro:
      'Connessione del NAS alla rete locale, via cavo o Wi-Fi. Con il cavo collegato il Wi-Fi è facoltativo.',
    connectedTo: 'Collegato a {name}',
    wiredConnection: 'rete via cavo',
    password: 'Password di rete',
    noNetworks: 'Nessuna rete Wi-Fi trovata',
    scan: 'Cerca reti',
    scanning: 'Ricerca delle reti in corso',
    security: 'Sicurezza',
    fixed:
      'Gestione della rete non disponibile in questa installazione, resta attiva la connessione attuale.',
    connect: 'Collega',
    connecting: 'Collegamento in corso',
    wifiNote: {
      noDevice: 'Nessuna scheda di rete Wi-Fi rilevata',
      noNetworkManager: 'Gestione delle reti Wi-Fi non disponibile sul NAS',
      unavailable: 'Elenco delle reti Wi-Fi non disponibile',
    },
  },
  disks: {
    title: 'Dischi dati',
    intro:
      'Dischi vuoti da preparare per i dati. I dischi con dati restano come sono e compaiono nell’app File. Il passaggio è facoltativo.',
    none: 'Nessun disco dati vuoto collegato.',
    inUse: 'Contiene già dati: resta com’è',
    options: {
      keep: 'Lascia così',
      plain: 'Inizializza',
      encrypted: 'Inizializza cifrato',
    },
    warning: 'Inizializzare un disco cancella tutto il suo contenuto.',
    encryptedNote:
      'Un disco cifrato si sblocca da solo all’avvio. Dopo l’accesso imposta una password e una chiave di recupero dall’app Dischi.',
  },
  token: {
    title: 'Token delle release',
    intro:
      'Token GitHub per scaricare gateway e launcher e, in seguito, le release private del launcher e delle applicazioni. Il token salvato non è più visualizzabile.',
    field: 'Token',
    invalid: 'Il token non può contenere spazi.',
    check: 'Verifica',
    emptyNote: 'Senza token si possono scaricare solo release pubbliche.',
    set: 'Impostato',
    notSet: 'Nessuno',
    access: {
      ok: 'Accessibile',
      refused: 'Token rifiutato',
      forbidden: 'Permessi mancanti',
      missing: 'Nessuna release o repository non visibile',
      unreachable: 'Non raggiungibile',
    },
  },
  summary: {
    title: 'Riepilogo',
    intro: 'Riepilogo delle scelte effettuate, da confermare per completare la configurazione.',
    connection: 'Connessione',
    noConnection: 'Non connessa',
    passwordSet: 'Impostata',
    complete: 'Completa',
    installNote:
      'Al termine vengono installati gateway e launcher, salvati il token, l’account e l’utente del terminale, quindi si apre l’interfaccia del NAS.',
    failed: 'Configurazione non avviata ({reason}).',
    disks: {
      label: 'Dischi da inizializzare',
      none: 'Nessuno',
      encrypted: 'cifrato',
    },
  },
  install: {
    title: 'Installazione del NAS',
    intro:
      'Installazione e configurazione del NAS in corso. L’operazione può richiedere alcuni minuti e la pagina si aggiorna automaticamente.',
    simulated: 'Configurazione simulata, nessuna installazione eseguita.',
    handover: 'Apertura dell’interfaccia del NAS in corso',
    steps: {
      downloadGateway: 'Scaricamento del gateway',
      downloadUi: 'Scaricamento del launcher',
      installGateway: 'Installazione del gateway',
      installUi: 'Installazione del launcher',
      configure: 'Token, utente del terminale e dischi dati',
      disks: 'Inizializzazione dei dischi dati',
      account: 'Account del NAS',
      certificate: 'Autorità HTTPS del NAS',
      complete: 'Lingua e tema del launcher',
      handover: 'Avvio del gateway',
    },
    states: {
      pending: 'In attesa',
      done: 'Completato',
      failed: 'Non riuscito',
    },
  },
  certificate: {
    title: 'Certificato HTTPS del NAS',
    loading: 'Lettura del certificato in corso',
    simulated: 'Configurazione simulata, nessun certificato disponibile.',
    authority: {
      title: 'Autorità del NAS',
      note: 'Il NAS è raggiungibile in HTTPS con un certificato firmato da questa autorità. L’installazione dell’autorità come attendibile nel sistema o nel browser evita l’avviso di connessione non sicura.',
      download: 'Scarica il certificato dell’autorità',
    },
    goToLogin: 'Vai all’accesso',
  },
} as const;
