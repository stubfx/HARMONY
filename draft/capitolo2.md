# 2. La logica dello sciame

C'è qualcosa di difficile da spiegare nella sensazione che si prova guardando uno stormo di storni muoversi nel cielo al tramonto. Non è soltanto bellezza visiva, è la percezione che quella forma stia pensando, che abbia intenzioni, che sappia dove vuole andare.

Non lo sa. O almeno, non nel senso in cui lo sappiamo noi.

## 2.1 In natura

La murmuration degli storni è forse il fenomeno collettivo più fotografato e studiato degli ultimi decenni. Migliaia di uccelli, a volte centinaia di migliaia, si muovono insieme come un unico organismo fluido, si espandono, si contraggono, girano, si dividono e si ricompongono senza che nessuno dia ordini. Gli studi hanno mostrato che ogni storno non tiene d'occhio l'intero stormo, ma soltanto una manciata di vicini, in media fra sei e sette, e regola su di loro la propria traiettoria. Avvicìnati a sufficienza, mantieni la velocità, evita gli urti, tre istruzioni e nient'altro, da cui nasce quello che vediamo nel cielo.

> **[IMG]** Fotografia di una murmuration di storni al tramonto: la forma collettiva che cambia nel cielo, nessun punto di partenza riconoscibile.

Le colonie di formiche funzionano sullo stesso principio, declinato in modo diverso. Una singola formica è quasi cieca, con una memoria brevissima e un repertorio di comportamenti molto limitato, eppure una colonia trova i percorsi più brevi tra il nido e il cibo, gestisce i propri morti, si difende dagli intrusi, e in alcune specie regola perfino la temperatura del nido. Lo fa attraverso la chimica, perché i feromoni lasciati da ogni formica modificano il comportamento di quelle che passano dopo. L'intelligenza non sta in nessuna formica, sta nel sistema di tracce che le formiche depositano nell'ambiente.

> **[IMG]** Colonia di formiche fotografata dall'alto: percorsi convergenti verso una fonte di cibo, organizzazione senza centro visibile.

Il Physarum polycephalum porta questo principio al suo estremo più sorprendente. È un organismo che vive in una zona grigia della biologia, a metà tra un animale e una pianta e in realtà né l'uno né l'altra, una massa unicellulare di colore giallo brillante che si espande lentamente su superfici umide in cerca di nutrimento. Non possiede neuroni, eppure, messo davanti a fonti di cibo distribuite nello spazio, trova quasi sempre il percorso più efficiente per collegarle. In un esperimento diventato celebre alcuni ricercatori hanno disposto frammenti di nutrimento come le città dell'area di Tokyo e hanno lasciato che il micelio crescesse tra loro, e in poche ore quello aveva formato una rete di connessioni quasi identica alla rete ferroviaria reale, costruita da ingegneri in decenni di pianificazione.

> **[IMG]** Il Physarum polycephalum che cresce su un piano con fonti di cibo posizionate come le città dell'area di Tokyo: la rete del micelio a confronto con la mappa ferroviaria reale.

Storni, formiche, Physarum. Tre sistemi che non si somigliano quasi per niente, eppure condividono la stessa struttura profonda, nessun coordinamento centrale, nessun piano complessivo, nessun elemento che veda più degli altri. Il comportamento globale emerge da interazioni locali ripetute milioni di volte.

## 2.2 Le regole semplici

A un certo livello di organizzazione appare qualcosa che, nelle parti prese da sole, non c'era. La biologia ha un nome per questo fenomeno, l'emergenza.

Un comportamento è emergente quando compare a un livello superiore rispetto alle componenti che lo generano, senza che nessuna di quelle componenti lo contenesse già. Non è magia, è una proprietà strutturale dei sistemi complessi, studiata con strumenti matematici e computazionali da decenni. Resta però controintuitiva, perché siamo abituati a pensare che la complessità richieda una mente complessa, e quando vediamo lo stormo curvare all'unisono cerchiamo d'istinto il leader, il punto di partenza, la volontà che ha deciso la forma. Non c'è.

Il concetto di agente autonomo descrive l'unità base di questi sistemi, un'entità che percepisce solo l'ambiente vicino, segue poche regole semplici e reagisce di conseguenza, senza istruzioni dall'esterno e senza una visione d'insieme. Ogni agente è per definizione parziale, vede una piccola porzione del mondo, agisce su quella, e produce effetti che diventano parte dell'ambiente percepito dagli altri. Il sistema è la somma di tutte queste azioni parziali, ma produce qualcosa che nessuna azione singola avrebbe potuto produrre.

> **[IMG]** Diagramma delle tre regole del modello Boids (separazione, allineamento, coesione): ogni agente e il suo campo di percezione locale, senza visione globale.

Il paradosso dell'intelligenza distribuita sta proprio qui, il sistema si comporta come se qualcuno lo guidasse, ma non c'è nessuno che guida. La forma nasce dalle relazioni, non dagli elementi, e il fatto che possa essere bella, funzionale o sorprendente non cambia la natura di ciò che la genera.

## 2.3 Dallo sciame biologico a quello digitale

Nel 1987 l'informatico Craig Reynolds presentò al SIGGRAPH, la principale conferenza di computer grafica, un sistema di simulazione che aveva chiamato Boids, con l'obiettivo di replicare il comportamento degli storni in un ambiente digitale. Aveva dato a ogni agente tre regole, separazione (mantieni una distanza minima dai vicini per non scontrarti), allineamento (vai nella direzione media dei vicini), coesione (tendi verso il centro del gruppo vicino). Nessuna regola globale, nessuna mappa dell'intero sistema.

Il risultato sorprese anche chi l'aveva costruito. I Boids si dividevano attorno agli ostacoli e si riunivano dall'altra parte, oscillavano, formavano code, si separavano e si ricompattavano. Reynolds aveva scritto tre regole, e il sistema ne mostrava molte di più, tutte emergenti e nessuna programmata, con quella qualità viva e auto-organizzata che nasceva da meccanismi presi uno per uno quasi banali.

> **[IMG]** Visualizzazione del modello Boids: agenti in movimento con le loro direzioni individuali visibili, che formano un flusso collettivo riconoscibile.

Da allora i principi dello sciame sono diventati uno strumento usato in contesti molto diversi. Gli algoritmi ispirati alle colonie di formiche servono a risolvere problemi di instradamento nelle reti e nella logistica, il comportamento del Physarum ha ispirato sistemi di ottimizzazione per la progettazione di infrastrutture, e le simulazioni di stormi vengono usate per modellare l'evacuazione delle folle, per animare masse di personaggi nei film, per generare immagini nell'arte digitale.

In tutti questi casi la simulazione fa due cose diverse. È uno strumento di analisi, perché costruire un sistema che si comporta come quello reale permette di isolare le regole che lo governano, ed è uno strumento creativo, perché le stesse logiche che spiegano il comportamento degli storni possono generare qualcosa che non sarebbe nato da una mente sola, qualcosa che sorprende anche chi lo ha costruito.

Questo progetto appartiene alla seconda categoria. Usa la logica dello sciame come strumento di costruzione, senza pretesa di fedeltà biologica, perché l'obiettivo è la qualità percettiva, la sensazione di trovarsi davanti a un organismo invece che a un programma.

Lo stesso principio si ritrova in un altro esempio classico, il Game of Life ideato dal matematico John Conway nel 1970. Qui non ci sono agenti che si muovono, ma una griglia di celle che vivono o muoiono in base a poche regole che contano solo i vicini immediati, e da quelle regole nascono forme che si spostano, si ripetono e si trasformano senza che nessuno le abbia disegnate. È un automa cellulare, l'emergenza nella sua forma più nuda. I Boids e il Game of Life sono i due sistemi autonomi da cui questo progetto ha preso spunto. Non vengono riprodotti tali e quali, ma è da loro che arriva l'idea di fondo, una macchina con un comportamento proprio, in cui l'ordine d'insieme emerge da regole locali e nessuno tiene il timone.

## 2.4 Lo sciame come metafora

C'è un'ultima cosa che i sistemi collettivi rivelano, e riguarda noi.

Usare lo sciame come modello per parlare di persone è una scelta con implicazioni precise. Gli esseri umani si aggregano, si influenzano a vicenda, producono comportamenti collettivi che nessuno ha pianificato, le mode, i movimenti, le ondate di panico o di entusiasmo in una folla. È il modo in cui un pubblico a teatro smette di essere una somma di individui e diventa qualcosa di unitario, con un'unica attenzione e una risposta emotiva condivisa che nessuno ha deciso ma che tutti stanno vivendo.

> **[IMG]** Fotografia di una folla o di un pubblico vista dall'alto: la struttura collettiva visibile, i singoli individui distinguibili ma parte di un pattern più grande.

Queste dinamiche non sono belle o brutte in sé, sono reali. E il fatto che funzionino secondo principi simili a quelli degli storni o delle formiche dice qualcosa di interessante, perché l'intelligenza collettiva emerge in qualunque contesto in cui agenti abbastanza semplici si trovano abbastanza vicini e abbastanza a lungo. I sistemi biologici sono solo uno di quei contesti.

Le città funzionano in modo simile a una colonia di formiche, perché nessuno progetta dall'alto i quartieri creativi, i mercati, le vie del commercio, che emergono invece da migliaia di decisioni individuali che si accumulano e si rinforzano a vicenda. La differenza è che gli esseri umani, a differenza delle formiche, sanno di farne parte. Possono osservare il sistema di cui sono elementi, e possono perfino scegliere di comportarsi diversamente una volta che ne riconoscono la logica.

È questa consapevolezza il punto che interessa al progetto, cosa succede quando le persone sanno di comportarsi come uno sciame, quando qualcuno mostra loro che il loro comportamento collettivo ha una forma, che quella forma è visibile in tempo reale, e che la si può osservare mentre si contribuisce a crearla.

Cosa cambia, nell'esperienza di far parte di qualcosa, quando si riesce a vederlo dall'interno?

Capire la logica di uno sciame è una cosa, diventarne parte è un'altra. Il capitolo che segue riguarda il punto di contatto tra la persona e il sistema, il corpo, il gesto e il dispositivo che in questo progetto li mette in relazione.
