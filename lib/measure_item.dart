/// ═══════════════════════════════════════════════════════════════════
///  ИЗДЕЛИЕ ЗАМЕРА  ·  v3.4.57
///  Один замер = один клиент + НЕСКОЛЬКО изделий (окно, балкон,
///  откосы, отлив…). Каждое изделие — это своя цепочка дерева,
///  своя комплектация, свои размеры, стеклопакет и створки.
///  Класс хранит всё это и умеет сохраняться в JSON (история, сервер).
/// ═══════════════════════════════════════════════════════════════════
class MeasureItem {
  MeasureItem({
    List<String>? path,
    List<String>? multi,
    Map<String, Map<String, int>>? sizes,
    this.glass = -1,
    this.widthMm = 0,
    this.heightMm = 0,
    List<int>? sashModes,
    this.sashManual = 0,
    List<double>? secW,
    List<int>? hinges,
  })  : path = path ?? const [],
        multi = multi ?? const [],
        sizes = sizes ?? const {},
        sashModes = sashModes ?? const [],
        secW = secW ?? const [],
        hinges = hinges ?? const [];

  /// Цепочка дерева: ЗАМЕР → ОКНО → вид → тип дома.
  final List<String> path;

  /// Отмеченная комплектация (финальный уровень дерева, мультивыбор).
  final List<String> multi;

  /// Размеры по пунктам комплектации — уже в МИЛЛИМЕТРАХ.
  final Map<String, Map<String, int>> sizes;

  /// Выбранный стеклопакет (-1 — не выбран).
  final int glass;

  /// Габарит изделия (вводится тапом по чертежу).
  final int widthMm;
  final int heightMm;

  /// Обозначение каждой створки (индекс в kSashModeNames).
  final List<int> sashModes;

  /// Ручное число створок (0 — по типу изделия из дерева).
  final int sashManual;

  /// Доли ширины секций (пусто — секции равные).
  final List<double> secW;

  /// Число петель на каждой створке (пусто — по 2: верхняя и нижняя).
  final List<int> hinges;

  /// Тип изделия (2-й уровень дерева): ОКНО, БАЛКОН, ДВЕРЬ…
  String get kind => path.length > 1 ? path[1] : '';

  /// Вид изделия (3-й уровень): ОДНОСТВОРЧАТОЕ, ДВУХСТВОРЧАТОЕ…
  String get type => path.length > 2 ? path[2] : '';

  /// Тип дома (4-й уровень): КИРПИЧКА, ПАНЕЛЬКА…
  String get house => path.length > 3 ? path[3] : '';

  /// Сколько створок: ручной выбор замерщика, иначе — по типу изделия.
  int get sashCount {
    if (sashManual > 0) return sashManual;
    final t = type.toUpperCase();
    if (t.contains('ТРЁХСТВ') || t.contains('ТРЕХСТВ')) return 3;
    if (t.contains('ДВУХСТВ') || t.contains('ДВУСТВ')) return 2;
    return 1;
  }

  /// Обозначения створок (индексы), приведённые к числу створок.
  List<int> get modes {
    final n = sashCount;
    if (sashModes.length == n) return sashModes;
    return List<int>.filled(n, 1);
  }

  /// Доли ширины секций, приведённые к числу створок.
  List<double> get secWidths {
    final n = sashCount;
    if (secW.length == n) {
      final sum = secW.fold<double>(0, (a, b) => a + b);
      if (sum > 0) return [for (final w in secW) w / sum];
    }
    return List<double>.filled(n, 1.0 / n);
  }

  /// Число петель на каждой створке.
  List<int> get hingeCounts {
    final n = sashCount;
    if (hinges.length == n) return hinges;
    return List<int>.filled(n, 2);
  }

  /// Габарит в ММ по названию поля (ищем по всем отмеченным пунктам).
  int mmOf(String field) {
    if (field == 'ШИРИНА' && widthMm > 0) return widthMm;
    if (field == 'ВЫСОТА' && heightMm > 0) return heightMm;
    for (final e in sizes.values) {
      final v = e[field];
      if (v != null && v > 0) return v;
    }
    return 0;
  }

  /// Изделие на балконе / лоджии: у подоконника, отлива и козырька
  /// ДРУГИЕ надбавки к длине. Признак — балкон/лоджия в дереве либо
  /// козырёк в комплектации (козырёк бывает только на балконе).
  bool get balcony {
    final all = [...path, ...multi].join(' ').toUpperCase();
    return all.contains('БАЛКОН') ||
        all.contains('ЛОДЖИ') ||
        all.contains('КОЗЫР');
  }

  /// Короткая подпись изделия для карточки: «ОКНО · ДВУХСТВОРЧАТОЕ».
  String get label {
    final p = [...path];
    if (p.isNotEmpty && p.first.toUpperCase().contains('ЗАМЕР')) p.removeAt(0);
    return p.isEmpty ? 'ИЗДЕЛИЕ' : p.join(' · ');
  }

  Map<String, dynamic> toJson() => {
        'path': path,
        'multi': multi,
        'sizes': sizes,
        'glass': glass,
        'widthMm': widthMm,
        'heightMm': heightMm,
        'sashModes': sashModes,
        'sashManual': sashManual,
        'secW': secW,
        'hinges': hinges,
      };

  static MeasureItem fromJson(Map<String, dynamic> j) {
    List<String> sl(dynamic v) =>
        v is List ? [for (final e in v) '$e'] : const [];
    List<int> il(dynamic v) =>
        v is List ? [for (final e in v) (e is num ? e.toInt() : 0)] : const [];
    List<double> dl(dynamic v) => v is List
        ? [for (final e in v) (e is num ? e.toDouble() : 0.0)]
        : const [];
    final rawSizes = j['sizes'];
    final sizes = <String, Map<String, int>>{};
    if (rawSizes is Map) {
      for (final e in rawSizes.entries) {
        final inner = e.value;
        if (inner is Map) {
          sizes['${e.key}'] = {
            for (final f in inner.entries)
              '${f.key}': f.value is num ? (f.value as num).toInt() : 0,
          };
        }
      }
    }
    return MeasureItem(
      path: sl(j['path']),
      multi: sl(j['multi']),
      sizes: sizes,
      glass: j['glass'] is num ? (j['glass'] as num).toInt() : -1,
      widthMm: j['widthMm'] is num ? (j['widthMm'] as num).toInt() : 0,
      heightMm: j['heightMm'] is num ? (j['heightMm'] as num).toInt() : 0,
      sashModes: il(j['sashModes']),
      sashManual: j['sashManual'] is num ? (j['sashManual'] as num).toInt() : 0,
      secW: dl(j['secW']),
      hinges: il(j['hinges']),
    );
  }
}
