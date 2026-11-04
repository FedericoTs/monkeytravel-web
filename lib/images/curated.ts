// What an activity shows when no photo of the place itself is found, and the
// type hint a photo proxy URL carries so a photo that later dies falls back to
// its own activity's type (app/api/places/photo).

// Curated fallback images by activity type.
//
// Look at every image before adding it; a resolution check is not enough:
// Pexels search returns wrong places, and its grey "missing image" placeholder
// is served with HTTP 200, so both pass such checks (see the note in
// app/api/images/destination/route.ts).
//
// A type fallback must not be a recognisable landmark, or a Belgian itinerary
// can show the Colosseum next to the Belfry of Bruges. Use anonymous old-town
// streets and architectural detail; famous monuments belong only in the
// per-destination map.
//
// Pool depth matters as much as type coverage: a shallow pool repeats the
// same photo within one trip. Every type has its own reviewed pool of at least
// MIN_POOL, so the widening in getCuratedImage is only a safety net.
const CURATED_BY_TYPE: Record<string, string[]> = {
  restaurant: [
    "https://images.pexels.com/photos/10135114/pexels-photo-10135114.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11794317/pexels-photo-11794317.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12181619/pexels-photo-12181619.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13869884/pexels-photo-13869884.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17206102/pexels-photo-17206102.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1872889/pexels-photo-1872889.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10135116/pexels-photo-10135116.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10148448/pexels-photo-10148448.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14885437/pexels-photo-14885437.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15189511/pexels-photo-15189511.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15372564/pexels-photo-15372564.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  foodie: [
    "https://images.pexels.com/photos/1327393/pexels-photo-1327393.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15390222/pexels-photo-15390222.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15671371/pexels-photo-15671371.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15671411/pexels-photo-15671411.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1639559/pexels-photo-1639559.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17989471/pexels-photo-17989471.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18015000/pexels-photo-18015000.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19671300/pexels-photo-19671300.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/23644633/pexels-photo-23644633.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  attraction: [
    "https://images.pexels.com/photos/11487781/pexels-photo-11487781.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12652452/pexels-photo-12652452.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14368431/pexels-photo-14368431.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15443208/pexels-photo-15443208.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/16350875/pexels-photo-16350875.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/28843295/pexels-photo-28843295.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/29026217/pexels-photo-29026217.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/30967258/pexels-photo-30967258.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  cultural: [
    "https://images.pexels.com/photos/10975757/pexels-photo-10975757.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13304717/pexels-photo-13304717.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13626838/pexels-photo-13626838.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13722612/pexels-photo-13722612.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19081217/pexels-photo-19081217.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19766571/pexels-photo-19766571.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/26974693/pexels-photo-26974693.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/28663466/pexels-photo-28663466.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/30319260/pexels-photo-30319260.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  nature: [
    "https://images.pexels.com/photos/10548535/pexels-photo-10548535.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10781049/pexels-photo-10781049.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11163057/pexels-photo-11163057.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13678556/pexels-photo-13678556.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/20463880/pexels-photo-20463880.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2158824/pexels-photo-2158824.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15527528/pexels-photo-15527528.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/16871285/pexels-photo-16871285.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15724087/pexels-photo-15724087.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  adventure: [
    "https://images.pexels.com/photos/11845063/pexels-photo-11845063.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12753943/pexels-photo-12753943.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13828102/pexels-photo-13828102.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14040199/pexels-photo-14040199.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1453488/pexels-photo-1453488.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/16627598/pexels-photo-16627598.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1687514/pexels-photo-1687514.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18193574/pexels-photo-18193574.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17809080/pexels-photo-17809080.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  museum: [
    "https://images.pexels.com/photos/13432768/pexels-photo-13432768.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15138850/pexels-photo-15138850.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15988007/pexels-photo-15988007.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1604991/pexels-photo-1604991.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1666667/pexels-photo-1666667.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1671016/pexels-photo-1671016.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17218992/pexels-photo-17218992.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19968227/pexels-photo-19968227.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2328867/pexels-photo-2328867.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  urban: [
    "https://images.pexels.com/photos/1115262/pexels-photo-1115262.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12345917/pexels-photo-12345917.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1269791/pexels-photo-1269791.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13069726/pexels-photo-13069726.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14570978/pexels-photo-14570978.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14757444/pexels-photo-14757444.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/16241095/pexels-photo-16241095.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17091398/pexels-photo-17091398.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  market: [
    "https://images.pexels.com/photos/104884/pexels-photo-104884.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10697692/pexels-photo-10697692.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10828209/pexels-photo-10828209.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11355644/pexels-photo-11355644.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11905679/pexels-photo-11905679.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17341188/pexels-photo-17341188.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18911914/pexels-photo-18911914.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18936011/pexels-photo-18936011.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  // Type strings the generator emits that reuse another type's pool; without
  // a key they would fall through to the generic widening.
  nature_attraction: [],   // filled below from `nature`
  cultural_attraction: [], // filled below from `cultural`
  food: [
    "https://images.pexels.com/photos/10054915/pexels-photo-10054915.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11066890/pexels-photo-11066890.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12955891/pexels-photo-12955891.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13788768/pexels-photo-13788768.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13823417/pexels-photo-13823417.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/154145/pexels-photo-154145.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1703272/pexels-photo-1703272.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17902588/pexels-photo-17902588.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19781592/pexels-photo-19781592.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  cafe: [
    "https://images.pexels.com/photos/1137745/pexels-photo-1137745.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11696469/pexels-photo-11696469.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12704634/pexels-photo-12704634.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14994661/pexels-photo-14994661.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15105621/pexels-photo-15105621.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18721993/pexels-photo-18721993.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/20454106/pexels-photo-20454106.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2067431/pexels-photo-2067431.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/2067552/pexels-photo-2067552.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  bar: [
    "https://images.pexels.com/photos/10356139/pexels-photo-10356139.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11538286/pexels-photo-11538286.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11538601/pexels-photo-11538601.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12176277/pexels-photo-12176277.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13030526/pexels-photo-13030526.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14866145/pexels-photo-14866145.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15290564/pexels-photo-15290564.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17119947/pexels-photo-17119947.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  landmark: [
    "https://images.pexels.com/photos/10706954/pexels-photo-10706954.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14808854/pexels-photo-14808854.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17706482/pexels-photo-17706482.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18331722/pexels-photo-18331722.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18463801/pexels-photo-18463801.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/27791779/pexels-photo-27791779.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/27975700/pexels-photo-27975700.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/28999565/pexels-photo-28999565.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  park: [
    "https://images.pexels.com/photos/13399314/pexels-photo-13399314.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14300713/pexels-photo-14300713.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14634845/pexels-photo-14634845.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17401148/pexels-photo-17401148.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18425557/pexels-photo-18425557.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19310067/pexels-photo-19310067.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19788574/pexels-photo-19788574.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/24538661/pexels-photo-24538661.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  activity: [
    "https://images.pexels.com/photos/10278819/pexels-photo-10278819.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10736818/pexels-photo-10736818.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/1088709/pexels-photo-1088709.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10933403/pexels-photo-10933403.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11357839/pexels-photo-11357839.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/11850545/pexels-photo-11850545.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12282461/pexels-photo-12282461.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14021071/pexels-photo-14021071.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14705559/pexels-photo-14705559.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15172901/pexels-photo-15172901.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  shopping: [
    "https://images.pexels.com/photos/12770245/pexels-photo-12770245.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12791209/pexels-photo-12791209.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13025991/pexels-photo-13025991.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13282014/pexels-photo-13282014.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/13532891/pexels-photo-13532891.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14875546/pexels-photo-14875546.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15054264/pexels-photo-15054264.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17645491/pexels-photo-17645491.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18260811/pexels-photo-18260811.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  entertainment: [
    "https://images.pexels.com/photos/10880677/pexels-photo-10880677.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12616961/pexels-photo-12616961.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12661846/pexels-photo-12661846.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12909317/pexels-photo-12909317.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19658083/pexels-photo-19658083.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/25857614/pexels-photo-25857614.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/26285734/pexels-photo-26285734.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  nightlife: [
    "https://images.pexels.com/photos/11457826/pexels-photo-11457826.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14075145/pexels-photo-14075145.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18799640/pexels-photo-18799640.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18976506/pexels-photo-18976506.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18976507/pexels-photo-18976507.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/18983602/pexels-photo-18983602.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19651776/pexels-photo-19651776.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19923641/pexels-photo-19923641.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/20074374/pexels-photo-20074374.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  spa: [
    "https://images.pexels.com/photos/1926811/pexels-photo-1926811.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/35884499/pexels-photo-35884499.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3681801/pexels-photo-3681801.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/4170175/pexels-photo-4170175.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/4974567/pexels-photo-4974567.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14929512/pexels-photo-14929512.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/19980238/pexels-photo-19980238.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/20705879/pexels-photo-20705879.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/23330922/pexels-photo-23330922.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3608965/pexels-photo-3608965.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/36420271/pexels-photo-36420271.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  wellness: [
    "https://images.pexels.com/photos/13811764/pexels-photo-13811764.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/3822086/pexels-photo-3822086.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/38263127/pexels-photo-38263127.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/4327043/pexels-photo-4327043.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/5890296/pexels-photo-5890296.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/5992856/pexels-photo-5992856.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/6582580/pexels-photo-6582580.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/6643238/pexels-photo-6643238.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/6648552/pexels-photo-6648552.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
  transport: [
    "https://images.pexels.com/photos/12367459/pexels-photo-12367459.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/14552060/pexels-photo-14552060.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/15460742/pexels-photo-15460742.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17315130/pexels-photo-17315130.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17499171/pexels-photo-17499171.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/17967886/pexels-photo-17967886.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10342323/pexels-photo-10342323.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/10994927/pexels-photo-10994927.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12568284/pexels-photo-12568284.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    "https://images.pexels.com/photos/12671703/pexels-photo-12671703.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  ],
};

CURATED_BY_TYPE.nature_attraction = CURATED_BY_TYPE.nature;
CURATED_BY_TYPE.cultural_attraction = CURATED_BY_TYPE.cultural;
const FALLBACK_IMAGES = [
  "https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/2087391/pexels-photo-2087391.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
];

/**
 * Get curated image for activity type
 */
const MIN_POOL = 6;

function getCuratedImage(type: string, index: number = 0): string {
  // Use the type's own pool when it is deep enough. Only a small pool is
  // widened with `attraction` + FALLBACK_IMAGES: widening every type would
  // splice generic old-town streets into `spa` or `nightlife`. Every known
  // type clears MIN_POOL, so in practice this widens only an unknown type
  // string, where generic scenery is the right answer.
  const own = CURATED_BY_TYPE[type.toLowerCase()] ?? [];
  const pool =
    own.length >= MIN_POOL
      ? own
      : [
          ...own,
          ...(CURATED_BY_TYPE["attraction"] ?? []),
          ...FALLBACK_IMAGES,
        ].filter((url, i, arr) => arr.indexOf(url) === i);
  return pool[index % pool.length] ?? FALLBACK_IMAGES[0];
}

/**
 * Stable curated-image picker based on activity name. Returns the same image
 * for the same name+type combo so a fallback hit is deterministic.
 */
export function curatedFor(name: string, type: string): string {
  // djb2, not a plain char-code sum: names in one trip share prefixes and
  // lengths ("Osteria da Fortunata", "Osteria Mario"), so their sums cluster
  // and collide on the same few slots of a small pool. Fewer repeats would
  // need distinct images assigned across a trip, which needs trip context
  // this function doesn't have.
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash * 33) ^ name.charCodeAt(i)) >>> 0;
  }
  return getCuratedImage(type || "attraction", hash);
}

/**
 * Activity type strings are `[a-z_]` in practice (`nature_attraction`,
 * `cultural_attraction`, …). Anything else is rejected on read rather than
 * sanitized — a type we don't recognise resolves to generic scenery anyway,
 * so there's nothing to gain from trying to salvage a malformed one.
 */
const TYPE_HINT_RE = /^[a-z_]{1,32}$/;

/** Read a `t=` type hint back off a proxy URL. Invalid/absent → "". */
export function readActivityTypeHint(raw: string | null | undefined): string {
  const t = (raw ?? "").toLowerCase();
  return TYPE_HINT_RE.test(t) ? t : "";
}

/**
 * Tag a `/api/places/photo` proxy URL with the activity type it was resolved
 * for, so that if Google's photo later dies the proxy can pick a fallback that
 * MATCHES the activity instead of generic scenery.
 *
 * Why the hint has to live in the URL: the proxy is addressed only by a Google
 * photo resource name, and the URL is what gets frozen into `trips.itinerary`
 * JSONB. There is no other channel — by the time the browser requests the
 * image, the activity that owns it is long out of scope.
 *
 * Why it is NOT set in `fetchPlacePhoto`: that result is cached per place_id in
 * `places_v2.photo_url`, and one place can back activities of different types
 * (a market that is `market` on one trip and `food` on another). Baking a type
 * into the cached row would let whichever trip resolved it first decide the
 * fallback for everyone. So the hint is attached HERE, per activity, at fan-out.
 *
 * No-op for anything that isn't our proxy — curated Pexels URLs are already
 * final and carry no place to hang a query param.
 */
export function withActivityTypeHint(url: string, type: string): string {
  if (!url.startsWith("/api/places/photo")) return url;
  const t = (type || "").toLowerCase();
  if (!TYPE_HINT_RE.test(t)) return url;
  // Never double-append: fetchActivityImages can re-run over an itinerary whose
  // URLs it already tagged (save-time enrichment re-walks generated trips).
  if (/[?&]t=/.test(url)) return url;
  return `${url}&t=${t}`;
}

/**
 * Move the `t=` hint from an old proxy URL onto its replacement.
 *
 * Needed because `places_v2.photo_url` is cached per PLACE and so carries no
 * hint: any code path that swaps a fresh canonical URL in over an old one (see
 * lib/places/refreshItineraryPhotos.ts) would otherwise strip the hint and
 * silently downgrade that activity's dead-photo fallback to generic scenery.
 *
 * Lives here rather than at the call site so all three hint operations share
 * one definition of what a hint looks like. No-op when the old URL has no hint
 * (URLs written before hints existed), when the replacement already carries
 * one, or when the replacement isn't our proxy.
 */
export function carryTypeHint(oldUrl: string | undefined | null, fresh: string): string {
  if (!oldUrl || !fresh.startsWith("/api/places/photo")) return fresh;
  if (/[?&]t=/.test(fresh)) return fresh;
  const hint = /[?&]t=([^&]*)/.exec(oldUrl)?.[1];
  return hint && TYPE_HINT_RE.test(hint) ? `${fresh}&t=${hint}` : fresh;
}
