# 8. Fare come forma di conoscenza

Costruire questo progetto ha insegnato cose che non avrei potuto imparare in nessun altro modo. Cose che vanno al di là della parte tecnica, oltre l'imparare un'API grafica o gestire connessioni in tempo reale. Si tratta di capire come si comporta un sistema complesso da dentro, mentre prende forma.

Esiste una forma di conoscenza che nasce soltanto dal fare. È una conoscenza diversa da quella che nasce dallo studio: più difficile da trasmettere, più difficile da documentare, strettamente legata all'esperienza diretta di costruire qualcosa che non è mai esistito nella forma in cui lo si immagina. C'è chi dice che il lavoro creativo non si produca tanto quanto si riceva, e che l'autore sia in ascolto di quello che il progetto stesso vuole diventare. L'idea che il lavoro possa avere una propria direzione, che spinga verso qualcosa che il creatore non aveva previsto, corrisponde esattamente a quello che è successo qui.

---

## 8.1 — L'errore come informazione

I sistemi di simulazione basati su agenti hanno una caratteristica che li rende particolarmente instabili nelle fasi di sviluppo: le interazioni tra migliaia di entità producono comportamenti emergenti che non si possono prevedere leggendo il codice. Un errore in una formula di movimento produce raramente un risultato sbagliato in modo ovvio: produce un comportamento inaspettato, che a volte è un bug e a volte è qualcosa di interessante.

Più volte durante lo sviluppo mi sono trovato davanti a comportamenti che non avevo scritto. Particelle che formavano strutture filiformi invece di cluster tondi. Correnti che si organizzavano in pattern ripetuti invece di fluire liberamente. Oscillazioni che sembravano respirazione. In alcuni casi erano errori da correggere. In altri erano proprietà emergenti del sistema che non sapevo di voler costruire, ma che una volta viste sembravano ovvie.

> **[IMG]** Screenshot di un comportamento emergente inaspettato della simulazione: un pattern o una struttura che non era stata progettata esplicitamente, visivamente interessante proprio per la sua natura non intenzionale.

Questo ha cambiato il modo in cui ho pensato alla simulazione. Ha smesso di essere un sistema che controllavo e ha cominciato a essere un sistema con cui negoziavo. Le mie decisioni tecniche producevano effetti che poi osservavo, valutavo, e usavo per prendere la decisione successiva. Il processo di sviluppo era esso stesso un'esperienza di sciame: io come agente, il sistema come ambiente, la simulazione come risultato emergente di quella relazione.

La distinzione che è emersa da questo processo è importante: c'è una differenza tra *simulare* un sistema e *capire come si comporta*. Si può costruire la formula giusta senza sapere cosa produrrà nel contesto delle migliaia di interazioni che avvengono ad ogni frame. La comprensione vera arriva solo dall'osservazione in esecuzione, dal vedere quello che succede quando il sistema gira davvero.

---

## 8.2 — Quando qualcosa ha funzionato

C'è un momento difficile da descrivere ma facile da riconoscere: il momento in cui un sistema smette di sembrare un esperimento e comincia a sembrare un'esperienza.

> **[IMG]** Screenshot di un momento particolarmente significativo della simulazione: composizione visiva intensa, luce e movimento in equilibrio, il sistema che sembra avere una propria presenza.

Per questo progetto, quel momento è arrivato la prima volta che ho visto le particelle rispondere all'input audio della stanza. Il sistema era già funzionante: le particelle si muovevano, i colori dei partecipanti erano visibili, il joystick funzionava. Ma quando ho capito che la luminosità dello sciame cambiava ogni volta che alzavo la voce, qualcosa ha cambiato qualità. Non stavo più guardando un programma che funzionava. Stavo guardando qualcosa che ascoltava.

Questa differenza è difficile da codificare in criteri oggettivi. Non si misura in frame rate o in numero di particelle. Si percepisce: c'è un momento in cui il sistema comincia ad avere una presenza, un carattere, qualcosa che lo rende riconoscibile come sé stesso invece che come una variante di qualcosa che esiste già. Riconoscere quel momento, e poi lavorare per preservare quella qualità nelle iterazioni successive, è uno degli obiettivi impliciti di qualsiasi processo creativo.

---

## 8.3 — La distanza tra l'intenzione e il risultato

Il progetto che avevo in mente all'inizio era diverso da quello che esiste adesso. Le grandi linee tengono. Sono i dettagli che si sono spostati, e in alcuni casi si sono spostati abbastanza da cambiare il senso complessivo dell'esperienza.

Alcune cose sono state semplificate: aspetti che sembravano fondamentali all'inizio si sono rivelati inutili una volta provati, o impossibili da implementare nei tempi disponibili, o semplicemente meno interessanti di quanto pensassi. La narrativa originale avrebbe dovuto essere più strutturata, più lineare, con un arco preciso. Nel processo, si è frammentata, e quella frammentazione si è rivelata più adatta all'esperienza.

Altre cose sono emerse durante il processo e si sono rivelate centrali: la reattività audio, per esempio, non era nel piano originale. È venuta fuori da una domanda semplice, cosa succederebbe se il sistema sentisse la stanza?, e ha cambiato in modo significativo la qualità dell'esperienza.

> **[IMG]** Documentazione di una fase intermedia dello sviluppo: screenshot più grezzo o interfaccia meno rifinita, a confronto implicito con lo stato attuale.

Questa distanza tra intenzione e risultato è una parte normale di qualsiasi processo creativo serio. È il segno che il lavoro ha avuto vita propria, e ha cambiato forma mentre era in costruzione. Chi costruisce qualcosa di non banale lo sa: l'oggetto finito raramente coincide con quello immaginato all'inizio, e quando coincide spesso è perché si è progettato in difetto, evitando di seguire le occasioni che il processo apriva strada facendo. Come scrive Rick Rubin in *The Creative Act* (2023), «il progetto non appartiene all'artista. L'artista è il custode del progetto, non il suo creatore.» Il lavoro ha una sua direzione che si manifesta solo attraverso il processo, e in anticipo non si può sapere dove porta. Si può solo stare attenti a riconoscerlo quando ci si arriva.

Alla fine quello che rimane è quello che si è riusciti a fare, con i vincoli del tempo, delle competenze disponibili e di quello che il sistema stesso suggeriva di diventare. Non è esattamente quello che si voleva fare. In molti casi, è meglio.
