# 2. La logica dello sciame

C'è qualcosa di difficile da spiegare nella sensazione che si prova guardando uno stormo di starni muoversi nel cielo al tramonto. Non è soltanto bellezza visiva. È qualcosa di più inquietante: la percezione che quella forma stia pensando. Che abbia intenzioni. Che sappia dove vuole andare.

Non lo sa. O almeno, non nel senso in cui lo sappiamo noi.

---

## 2.1 — In natura

La murmuration degli storni è forse il fenomeno collettivo più fotografato e studiato degli ultimi decenni. Migliaia di uccelli, a volte centinaia di migliaia, si muovono insieme come se fossero un unico organismo fluido: si espandono, si contraggono, girano, si dividono e si ricompongono, senza che nessuno dia ordini. La ricerca condotta da Andrea Cavagna e dai suoi colleghi all'Università di Roma ha dimostrato che ogni storno calibra la propria traiettoria sulla base di sette vicini prossimi, non di più. Avvicinati abbastanza, mantieni la velocità, evita le collisioni. Tre istruzioni, senza eccezioni. Il risultato è quello che vediamo nel cielo.

Le colonie di formiche funzionano secondo lo stesso principio, declinato in modo diverso. Una formica singola è un animale quasi cieco, con una memoria brevissima e un repertorio comportamentale molto limitato. Eppure una colonia trova i percorsi più brevi tra il nido e il cibo, regola la temperatura interna, gestisce i propri cadaveri, si difende dagli intrusi. Lo fa attraverso la chimica: le feromoni lasciate da ogni formica modificano il comportamento di quelle che vengono dopo. L'intelligenza non risiede in nessuna formica. Risiede nel sistema di tracce che le formiche producono e lasciano nell'ambiente.

Il Physarum polycephalum porta questo principio al suo estremo più sorprendente. Non è un animale, non è una pianta: è un micelio, una massa unicellulare che si espande lentamente attraverso superfici umide in cerca di nutrimento. Non ha neuroni, non ha cervello, non ha nessuna struttura che assomigli a un organo decisionale. Eppure, messo di fronte a fonti di cibo distribuite nello spazio, trova invariabilmente il percorso più efficiente per collegarle. In uno studio pubblicato su *Science* nel 2010, i ricercatori Atsushi Tero e colleghi hanno replicato la disposizione geografica delle principali città dell'area metropolitana di Tokyo usando frammenti di nutrimento, e hanno lasciato che il Physarum crescesse tra di loro. In poche ore, il micelio aveva prodotto una rete di connessioni quasi identica alla rete ferroviaria reale, costruita da ingegneri nel corso di decenni di pianificazione. Come concludono gli autori dello studio: «The Physarum network shows characteristics of good transport network design, namely high efficiency, low cost, and resilience against failures.»

Storni, formiche, Physarum. Tre sistemi che non si somigliano quasi per niente, eppure condividono la stessa struttura profonda: nessun coordinamento centrale, nessun piano complessivo, nessun elemento che veda più degli altri. Il comportamento globale emerge da interazioni locali ripetute milioni di volte.

---

## 2.2 — Le regole semplici

> *«Il tutto è più della somma delle sue parti.»*
> Aristotele, *Metafisica*

Aristotele non stava parlando di storni. Ma la frase descrive esattamente quello che succede in un sistema collettivo: a un certo livello di organizzazione, appare qualcosa che non era presente negli elementi singoli. La biologia ha un nome per questo fenomeno: emergenza.

Un comportamento è emergente quando compare a un livello superiore rispetto alle componenti che lo generano, senza che nessuna di quelle componenti lo contenesse già. Non è magia, e non è nemmeno un mistero irrisolto: è una proprietà strutturale dei sistemi complessi, studiata con strumenti matematici e computazionali da almeno quarant'anni. Ma rimane controintuitiva. Siamo abituati a pensare che la sofisticazione richieda una mente sofisticata. Quando vediamo lo stormo curvare all'unisono, cerchiamo istintivamente il leader, il punto di partenza, la volontà che ha deciso la forma. Non c'è.

Il concetto di agente autonomo descrive l'unità base di questi sistemi: un'entità che percepisce l'ambiente locale, segue un insieme di regole semplici, e reagisce di conseguenza, senza ricevere istruzioni dall'esterno e senza avere una visione d'insieme. Ogni agente è, per definizione, parziale. Vede una piccola porzione del mondo, agisce su quella porzione, produce effetti che diventano parte dell'ambiente che altri agenti percepiranno. Il sistema è la somma di tutte queste azioni parziali, ma produce qualcosa che nessuna azione singola avrebbe potuto produrre.

Il paradosso dell'intelligenza distribuita sta proprio qui: il sistema si comporta come se qualcuno lo stesse guidando, ma non c'è nessuno che guida. La forma nasce dalle relazioni, non dagli elementi. E il fatto che questa forma possa essere bella, funzionale, o sorprendente non cambia la natura di ciò che la genera.

---

## 2.3 — Dallo sciame biologico a quello digitale

Nel 1987, l'informatico Craig Reynolds presentò al SIGGRAPH, la principale conferenza internazionale di computer grafica, un sistema di simulazione che aveva chiamato Boids. L'obiettivo era replicare il comportamento degli storni in un ambiente digitale. Reynolds aveva identificato tre regole fondamentali che ogni agente avrebbe dovuto seguire: separazione (mantieni una distanza minima dai tuoi vicini per evitare collisioni), allineamento (orienta la tua direzione verso la media di quella dei vicini), coesione (muoviti verso il centro del gruppo locale). Nessuna regola globale. Nessuna mappa dell'intero sistema.

Il risultato fu inatteso anche per chi lo aveva costruito. I Boids si dividevano attorno agli ostacoli e si riunivano dall'altra parte. Oscillavano, formavano code, si separavano e si ricompattavano. Reynolds aveva scritto tre regole: il sistema ne aveva esibite molte di più, tutte emergenti, nessuna programmata. Come osservò lui stesso, il sistema aveva prodotto «the lifelike quality of self-organization» a partire da meccanismi che, presi singolarmente, erano quasi banali.

Da quel momento, i principi dello sciame sono diventati uno strumento computazionale applicato in contesti molto diversi. Gli algoritmi ispirati alle colonie di formiche, noti come *Ant Colony Optimization*, vengono usati per risolvere problemi di routing nelle reti di comunicazione e nella logistica. Il comportamento del Physarum ha ispirato sistemi di ottimizzazione topologica per la progettazione di infrastrutture. Le simulazioni di storni vengono usate per modellare l'evacuazione delle folle in ambienti urbani, per animare masse di personaggi nei film, per generare effetti visivi generativi nell'arte digitale.

In tutti questi casi, la simulazione svolge due funzioni diverse. Da un lato è uno strumento di analisi: costruire un sistema che si comporta come quello reale permette di isolare le regole che lo governano. Dall'altro è uno strumento creativo: le stesse logiche che spiegano il comportamento degli storni possono generare qualcosa che non sarebbe nato da una mente sola. Qualcosa che sorprende anche chi lo ha costruito.

Questo progetto appartiene alla seconda categoria. Non cerca di replicare uno sciame biologico, cerca di usarne la logica per costruire qualcosa che abbia la stessa qualità percettiva: la sensazione di trovarsi davanti a un organismo, non a un programma.

---

## 2.4 — Lo sciame come metafora

C'è un'ultima cosa che i sistemi collettivi rivelano, e riguarda noi.

Usare lo sciame come modello per parlare di persone è una scelta con implicazioni precise. Gli esseri umani si aggregano, si influenzano reciprocamente, producono comportamenti collettivi che nessuno ha pianificato. Le mode, i movimenti, le ondate di panico o di entusiasmo in una folla. Il modo in cui un pubblico a teatro smette di essere una somma di individui e diventa qualcosa di unitario, con un'unica attenzione, una risposta emotiva condivisa che nessuno ha deciso ma tutti stanno vivendo.

Queste dinamiche non sono belle o brutte in sé. Sono reali. E il fatto che funzionino secondo principi simili a quelli degli storni o delle colonie di formiche dice qualcosa di interessante: che l'intelligenza collettiva non è un privilegio di sistemi biologici complessi, ma un fenomeno che emerge ogni volta che agenti sufficientemente semplici si trovano abbastanza vicini e abbastanza a lungo.

Steven Johnson, nel suo saggio *Emergence* (2001), osserva che le città funzionano in modo analogo alle colonie di formiche: nessuno progetta dall'alto i quartieri creativi, i mercati, le vie del commercio. Emergono da migliaia di decisioni individuali che si accumulano e si rinforzano a vicenda. La differenza con una colonia di formiche è che gli esseri umani, a differenza delle formiche, sanno di farne parte. Possono osservare il sistema di cui sono elementi. Possono persino scegliere di comportarsi diversamente una volta che ne riconoscono la logica.

È questa consapevolezza il punto che interessa questo progetto. Non cosa succede quando le persone si comportano come uno sciame senza saperlo. Ma cosa succede quando lo sanno. Quando qualcuno mostra loro che il loro comportamento collettivo ha una forma, che quella forma è visibile in tempo reale, che si può osservare mentre si contribuisce a crearla.

Cosa cambia, nell'esperienza di far parte di qualcosa, quando si riesce a vederlo dall'interno?
