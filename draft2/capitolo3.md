# 3. La riflessione

Un passo indietro, per guardare cosa ha insegnato il processo, cosa resta aperto e cosa il progetto dice di noi.

## 3.1 Il fare

Costruire questo progetto ha insegnato cose che non avrei potuto imparare in nessun altro modo. Cose che vanno oltre la parte tecnica, oltre l'imparare un'API grafica o gestire connessioni in tempo reale. Riguardano il capire come si comporta un sistema complesso da dentro, mentre prende forma.

Esiste una forma di conoscenza che nasce soltanto dal fare. È diversa da quella che nasce dallo studio, più difficile da trasmettere e da documentare, legata all'esperienza diretta di costruire qualcosa che non è mai esistito nella forma in cui lo si immagina. Mi è capitato spesso di avere la sensazione che il lavoro non si producesse, quanto piuttosto si ricevesse. Che ci fosse una direzione da ascoltare più che da imporre, e che il progetto spingesse verso qualcosa che non avevo previsto.

### 3.1.1 L'errore come informazione

I sistemi di simulazione basati su agenti sono particolarmente instabili nelle fasi di sviluppo, perché le interazioni tra migliaia di entità producono comportamenti emergenti che non si possono prevedere leggendo il codice. Un errore in una formula di movimento raramente dà un risultato sbagliato in modo ovvio. Produce invece un comportamento inaspettato, che a volte è un bug e a volte è qualcosa di interessante.

Più volte, durante lo sviluppo, mi sono trovato davanti a comportamenti che non avevo scritto. Particelle che formavano strutture filiformi invece di ammassi tondi. Correnti che si organizzavano in schemi ripetuti invece di fluire libere. Oscillazioni che sembravano un respiro. In alcuni casi erano errori da correggere. In altri erano proprietà emergenti del sistema che non sapevo di voler costruire, ma che una volta viste sembravano ovvie.

> **[IMG]** Screenshot di un comportamento emergente inaspettato della simulazione: un pattern o una struttura che non era stata progettata esplicitamente, visivamente interessante proprio per la sua natura non intenzionale.

Questo ha cambiato il modo in cui pensavo alla simulazione. Ha smesso di essere un sistema che controllavo ed è diventato un sistema con cui negoziavo. Le mie decisioni tecniche producevano effetti che poi osservavo e valutavo, e che usavo per prendere la decisione successiva. Lo stesso processo di sviluppo era un'esperienza di sciame, con me come agente, il sistema come ambiente e la simulazione come risultato emergente di quella relazione.

Da qui è emersa una distinzione che conta, quella tra simulare un sistema e capire come si comporta. Si può scrivere la formula giusta senza sapere cosa produrrà nel groviglio di migliaia di interazioni a ogni fotogramma. La comprensione vera arriva solo dall'osservazione in esecuzione, da quello che succede quando il sistema gira davvero.

### 3.1.2 Quando qualcosa ha funzionato

C'è un momento difficile da descrivere ma facile da riconoscere, quello in cui un sistema smette di sembrare un esperimento e comincia a sembrare un'esperienza.

> **[IMG]** Screenshot di un momento particolarmente significativo della simulazione: composizione visiva intensa, luce e movimento in equilibrio, il sistema che sembra avere una propria presenza.

Per questo progetto è arrivato la prima volta che ho visto le particelle rispondere al suono della stanza. Il sistema già funzionava, le particelle si muovevano, i colori dei partecipanti erano visibili, il joystick rispondeva. Ma quando ho capito che la luminosità dello sciame cambiava ogni volta che alzavo la voce, qualcosa è cambiato di qualità. Non stavo più guardando un programma che funzionava. Stavo guardando qualcosa che ascoltava.

Questa differenza è difficile da ridurre a criteri oggettivi. Non si misura in fotogrammi al secondo o in numero di particelle. Si percepisce. C'è un momento in cui il sistema comincia ad avere una presenza, un carattere, qualcosa che lo rende riconoscibile come sé stesso invece che come la variante di qualcosa che esiste già. Riconoscere quel momento, e poi lavorare per conservarlo nelle iterazioni successive, è uno degli obiettivi impliciti di qualsiasi processo creativo.

### 3.1.3 La distanza tra l'intenzione e il risultato

Il progetto che avevo in mente all'inizio era diverso da quello che esiste adesso. Le grandi linee tengono. Ma sono i dettagli a essersi spostati, e in alcuni casi si sono spostati abbastanza da cambiare il senso complessivo dell'esperienza.

Alcune cose sono state semplificate, perché aspetti che all'inizio sembravano fondamentali si sono rivelati inutili una volta provati, o impossibili da fare nei tempi disponibili, o semplicemente meno interessanti di quanto pensassi. La narrazione, che avrebbe dovuto essere più strutturata e lineare, con un arco preciso, lungo il percorso si è frammentata. E quella frammentazione si è rivelata più adatta all'esperienza.

Altre cose sono emerse durante il lavoro e si sono rivelate centrali. La reattività al suono, per esempio, non era nel piano iniziale. È nata da una domanda semplice, cosa succederebbe se il sistema sentisse la stanza, e ha cambiato in modo profondo la qualità dell'esperienza.

> **[IMG]** Documentazione di una fase intermedia dello sviluppo: screenshot più grezzo o interfaccia meno rifinita, a confronto implicito con lo stato attuale.

Questa distanza tra intenzione e risultato è una parte normale di ogni processo creativo serio. È il segno che il lavoro ha avuto una vita propria e ha cambiato forma mentre veniva costruito. Chi costruisce qualcosa di non banale lo sa, perché l'oggetto finito raramente coincide con quello immaginato all'inizio, e quando coincide spesso è perché si è progettato in difetto, evitando le occasioni che il processo apriva strada facendo. Rick Rubin, in *The Creative Act* del 2023, descrive l'artista come il custode di un progetto più che come il suo proprietario, qualcosa che ha una direzione propria che si rivela solo attraverso il fare. In anticipo non si può sapere dove porta. Si può solo stare attenti a riconoscerlo quando ci si arriva.

Alla fine quello che rimane è quello che si è riusciti a fare, con i vincoli del tempo, delle competenze disponibili e di quello che il sistema stesso suggeriva di diventare. Non è esattamente quello che volevo fare. In molti casi, è meglio.

## 3.2 Il dialogo

Il rapporto tra una persona e un sistema interattivo non è mai semplice come sembra. Si entra in uno spazio con l'idea di controllare qualcosa, e si scopre che qualcosa, intanto, sta controllando noi. Il ruolo di soggetto che ci si era assunti entrando si rivela parziale, perché di fronte a un sistema che risponde si è anche oggetto.

Questa circolarità è al centro di molte delle domande più interessanti aperte dalla tecnologia computazionale negli ultimi decenni. Non interessa qui chi sia più intelligente, l'umano o la macchina. Interessa come si trasforma la relazione tra i due quando il sistema è abbastanza complesso da rispondere in modi non del tutto prevedibili.

### 3.2.1 Chi guida chi

In un sistema di particelle orientate dai partecipanti, la risposta alla domanda su chi guidi è sempre provvisoria. I partecipanti guidano le proprie particelle, e questo è ovvio. Ma il comportamento delle particelle altrui influenza quello che si vede, e quello che si vede influenza i gesti successivi. Il sistema ha una logica propria che resiste alle direzioni individuali, e la narrazione che arriva dall'esterno orienta l'attenzione.

Alla fine non è chiaro chi stia guidando. O meglio, guidano tutti e nessuno guida del tutto. Il controllo è distribuito come nello sciame, perché nessuno vede l'intero, ognuno influenza una porzione, e il risultato finale appartiene a tutti i partecipanti insieme senza appartenere a nessuno in particolare.

> **[IMG]** Diagramma della circolarità dell'influenza: partecipanti che influenzano il sistema, il sistema che modifica il comportamento dei partecipanti, la narrativa esterna come terzo elemento.

Alan Turing, nel saggio del 1950 *Computing Machinery and Intelligence*, si chiedeva se si potesse mai distinguere, in una conversazione, una risposta umana da una risposta di macchina. La sua domanda riguardava la simulazione del linguaggio, ma la struttura del problema vale anche qui. Quando non si riesce più a distinguere quali parti del comportamento del sistema vengono dai partecipanti e quali dalla sua logica interna, diventa difficile dire chi stia guidando.

In questo progetto l'ambiguità è voluta. Il sistema non vuole essere trasparente, vuole essere percepito come qualcosa con cui si è in relazione e non come uno strumento che si usa. E la circolarità dell'influenza, il fatto che nessuno abbia il controllo completo, fa parte di questa intenzione.

### 3.2.2 Il sistema come specchio

Uno degli effetti più interessanti di un sistema collettivo è che rivela strutture che, guardando i singoli, non si vedevano. Le persone in una stanza si organizzano in modi che nessuna di loro ha pianificato. Formano gruppi, seguono leader informali, producono ritmi condivisi di attenzione. Sono strutture reali, ma di solito invisibili.

Quando il comportamento collettivo di un gruppo viene visualizzato in tempo reale su uno schermo grande, quelle strutture diventano osservabili. Si vede dove si concentra l'attenzione del gruppo. Si vede se qualcuno sta guidando il movimento degli altri anche senza volerlo. Si vede il ritmo collettivo nella forma del flusso.

> **[IMG]** Screenshot che mostra un pattern visivo chiaro emergente dal comportamento collettivo: una struttura nel flusso che rivela l'organizzazione implicita del gruppo in quel momento.

Vale qui la stessa logica dello specchio che trasforma di cui ho parlato nel primo capitolo. Il sistema non restituisce una copia fedele di ciò che riceve, lo traduce, e la traduzione introduce una distanza interpretativa che rende osservabile quello che altrimenti resterebbe invisibile. Su scala collettiva questa traduzione lavora su un materiale più complesso del movimento di un singolo corpo, perché lavora sul comportamento aggregato di un gruppo. Quello che si vede sullo schermo è il gruppo, ma trasformato in qualcosa che il gruppo non avrebbe potuto vedere di sé in nessun altro modo.

Questa trasformazione ha un effetto preciso, perché rende osservabile quello che di solito si sente soltanto. Si può avere la sensazione di far parte di un gruppo coeso, o di un gruppo disperso. Con questo sistema quella sensazione prende una forma visiva. La si può vedere.

### 3.2.3 La macchina che propone

Tutti gli aspetti descritti fin qui, le particelle, i momenti di partecipazione, la narrazione, condividono una caratteristica che non ho ancora nominato apertamente. Il sistema non aspetta.

> **[IMG]** Lo sciame in uno stato attivo senza input esterno: le particelle si muovono secondo una propria logica visibile, mentre la stanza è ancora vuota.

Quando le persone entrano nella stanza, il sistema ha già qualcosa in corso. Esiste prima che qualcuno arrivi, e continuerà a esistere dopo che se ne sarà andato.

Questo cambia tutto nel tipo di relazione che si stabilisce. Davanti a un ambiente già in movimento la prima domanda non è come usarlo, ma cosa stia facendo. Si osserva prima di agire, si cerca di capire la logica prima di intervenire. È una postura molto diversa da quella di chi usa uno strumento, perché chi usa uno strumento si avvicina con uno scopo già pronto e cerca i tasti che servono a raggiungerlo, mentre chi entra in questo progetto, le prime volte, si trova senza scopo. E quel vuoto, lontano dall'essere un difetto dell'interfaccia, è esattamente ciò che il sistema cerca di produrre.

Il sistema propone. Propone un comportamento, un ritmo, una qualità dell'esperienza, e i partecipanti rispondono a quella proposta con la propria. Il dialogo è già iniziato quando si collega il telefono, perché si entra in una conversazione in corso, non se ne apre una nuova.

È un modello molto diverso da quello dell'assistente conversazionale, che aspetta la domanda e risponde. È più vicino a un musicista che sta già suonando quando gli altri entrano nella stanza, dove l'interazione comincia dall'ascolto e non dall'interrogazione.

### 3.2.4 Un'estetica della relazione

Nicolas Bourriaud, nel libro *Estetica relazionale* del 1998, descrive una tendenza dell'arte degli anni Novanta verso opere che producono modi di stare insieme, forme di relazione, più che oggetti da contemplare. L'opera diventa un contesto, lo spazio in cui nascono incontri tra persone, tra persone e sistemi, tra idee e corpi, e smette di essere un messaggio trasmesso da un autore a un pubblico.

Questo progetto appartiene a quella tradizione, ma la prolunga in una direzione che Bourriaud non poteva prevedere. Il sistema stesso diventa un interlocutore attivo, una presenza che partecipa alla relazione invece di limitarsi a ospitarla.

> **[IMG]** Fotografia o screenshot che cattura l'esperienza complessiva dell'installazione: persone nella sala, proiezione grande sullo sfondo, telefoni in mano, la dimensione collettiva dell'evento.

Quello che il progetto propone, implicitamente, è un modo diverso di pensare il rapporto tra umani e sistemi intelligenti. Un modo lontano sia dallo strumento che si usa quando serve sia dall'oracolo che risponde alle domande, più vicino a una presenza, un sistema che ha una vita propria, che si modifica in risposta al contesto, che offre qualcosa e in cambio chiede qualcosa. Una funzione che diventa relazione.

Questa proposta non ha ambizioni di universalità. È un esperimento, un prototipo, una domanda posta attraverso la forma invece che attraverso il testo. E come ogni domanda posta bene non esaurisce il problema che apre, lo rende più preciso, più maneggiabile, più difficile da ignorare.

## 3.3 Il futuro

Costruire qualcosa insegna anche cosa non si riesce a fare. E non è un dato neutro, perché i limiti di un sistema ne rivelano la natura con la stessa precisione delle sue possibilità. Quello che un sistema non sa fare dice dove finisce la sua intelligenza e dove comincia la necessità di qualcosa di diverso.

### 3.3.1 Cosa il sistema non riesce ancora a fare

Il limite più evidente è nella qualità dell'ascolto. Il sistema percepisce il volume della stanza, ma non distingue i suoni. Non sa se quello che sente è musica, conversazione, applauso o silenzio improvviso. Risponde alla quantità di suono, non alla sua qualità, e questo produce effetti interessanti ma restringe la gamma di risposte possibili, perché il sistema non può reagire in modo diverso a una risata collettiva e a un rumore di sottofondo casuale.

Una limitazione simile riguarda la visione. Il sistema non vede la stanza, non sa quante persone ci sono, dove sono, se si muovono o stanno ferme. L'unico canale di informazione sul comportamento fisico dei partecipanti è il telefono. Resta fuori gran parte di ciò che un corpo fa in uno spazio, la postura, il movimento, la direzione dello sguardo, la distanza dagli altri.

> **[IMG]** Diagramma schematico di quello che il sistema percepisce (volume audio, input touch) rispetto a quello che non vede (posizione fisica, gesti corporei, espressioni, numero di persone presenti).

Un'altra limitazione riguarda la memoria. Il sistema non ricorda. Ogni sessione comincia da zero, le particelle non sanno nulla delle sessioni precedenti e niente di quello che succede in quella corrente diventa permanente. È potente nel brevissimo termine, ma sul tempo lungo è cieco. Non ha storia, perché il pubblico di ieri sera non lascia tracce visibili a quello di stasera, e tutto ricomincia da capo a ogni accensione, come se il sistema fosse stato appena costruito.

Infine c'è un limite che riguarda la scala dell'esperienza. Il progetto è stato concepito e provato in condizioni controllate, e non è ancora stato esposto a un pubblico reale in un contesto espositivo vero. Molte delle assunzioni che lo attraversano, su come reagiscono le persone, su quanto tempo restano connesse, su come si comporta il sistema con dieci o venti partecipanti insieme, restano ipotesi da verificare.

### 3.3.2 La questione della scala

Il progetto è pensato per una sala di dimensioni moderate, con un numero limitato di partecipanti. A questa scala funziona, perché c'è abbastanza partecipazione da produrre dinamiche collettive interessanti e abbastanza controllo da gestire la connessione in tempo reale.

Ma cosa succederebbe con cento persone? Con mille? In uno spazio aperto, in una piazza, in un aeroporto?

> **[IMG]** Schizzo o mock-up concettuale del sistema in uno spazio pubblico di grandi dimensioni: visualizzazione ipotetica di un'installazione in un grande auditorium, in una piazza, o in un atrio di stazione.

Le sfide tecniche di questa espansione sono reali ma risolvibili. Quelle concettuali sono più interessanti. Con mille partecipanti le dinamiche collettive cambierebbero natura, si formerebbero sottogruppi, emergerebbero strutture di influenza più complesse, e la logica dello sciame diventerebbe ancora più evidente e meno controllabile. Il singolo si sentirebbe ancora meno un agente di controllo, e ancora di più parte di qualcosa che lo supera.

Potrebbe essere bellissimo. Oppure soverchiante nel senso peggiore, qualcosa che non lascia spazio all'individuo e lo annulla invece di includerlo. La differenza tra i due esiti dipende da scelte di design che a questa scala non sono ancora state fatte. È una domanda aperta.

### 3.3.3 Estensioni possibili

Le direzioni in cui questo progetto potrebbe crescere sono molte, e non tutte tecnologiche.

Sul fronte dei sensi, il suono è già presente come input, ma potrebbe diventare anche output. Un sistema che risponde al suono della stanza producendo a sua volta suono, in una retroazione audio-visiva, aprirebbe una dimensione del tutto nuova. Allo stesso modo, sistemi di visione artificiale potrebbero estendere la percezione del sistema dal tocco sullo schermo al corpo intero, alla postura, al movimento, alla direzione dello sguardo.

Sul fronte del tempo, un sistema che ricorda. Che tiene traccia di quello che è successo nelle sessioni passate, che si modifica lentamente nel corso di settimane o mesi di esposizione, che porta con sé la storia del pubblico che l'ha attraversato. Sarebbe una memoria diversa da quella umana, ma del tutto reale, un sistema che cambia perché è stato vissuto.

> **[IMG]** Tavola concettuale con schizzi di possibili estensioni: nuovi sensi integrati (visione, temperatura), configurazioni spaziali diverse, timeline di evoluzione del sistema nel tempo.

Sul fronte dei luoghi, installazioni distribuite in più spazi insieme, connesse in rete. Sciami che si trovano in città diverse ma si influenzano a vicenda in tempo reale, e la distanza fisica che scompare nella condivisione di uno sciame comune. Persone a Milano e persone a Tokyo che muovono lo stesso sistema e vedono sullo schermo il risultato di azioni che nessuno di loro conosce per intero.

Tutte queste direzioni sono possibili. Nessuna è ovvia, e ognuna richiederebbe di affrontare problemi che questo progetto non ha ancora toccato. Ma la logica di base è già qui, un organismo distribuito che risponde al contesto e produce qualcosa di significativo quando le persone si avvicinano abbastanza, e abbastanza a lungo.
