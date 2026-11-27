import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:trillionai_testlab/main.dart';

const earlier = '00000000-0000-4000-8000-000000000001';
const later = '00000000-0000-4000-8000-000000000002';

Map<String, dynamic> reportFixture() => {
  'schemaVersion': 1, 'id': earlier, 'project': 'fixture', 'status': 'FAILED',
  'observations': [{'status': 'FAILED'}], 'productionReady': false,
  'sourceRevision': {'status': 'UNKNOWN'},
  'integrity': {'algorithm': 'sha256', 'assertion': 'checksum-only-not-signed', 'digest': 'a'.padLeft(64, 'a')},
};

Map<String, dynamic> comparisonFixture() => {
  'schemaVersion': 1, 'project': 'fixture', 'profile': 'node-built-in-tests',
  'status': 'OBSERVATIONS_DIFFER',
  'before': {'id': earlier, 'status': 'FAILED', 'exitCode': 1, 'integrityDigest': 'a'.padLeft(64, 'a')},
  'after': {'id': later, 'status': 'PASSED', 'exitCode': 0, 'integrityDigest': 'b'.padLeft(64, 'b')},
  'revisionComparison': 'NOT_ESTABLISHED', 'environmentEquivalenceVerified': false,
  'productCertified': false, 'productionReady': false,
};

Finder field(String label) => find.byWidgetPredicate((w) => w is TextField && w.decoration?.labelText == label);
Future<void> showControl(WidgetTester tester, Finder target) async {
  await tester.scrollUntilVisible(target, 180, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}
Future<void> fill(WidgetTester tester, String label, String value) async {
  final target = field(label);
  await showControl(tester, target);
  await tester.enterText(target, value);
  tester.testTextInput.hide();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('device inventory filters platforms and clears stale data after an unavailable refresh', (tester) async {
    var attempts = 0;
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/device-farm');
      attempts++;
      if (attempts == 2) return http.Response('{}', 503);
      return http.Response(jsonEncode({
        'status': 'RACK_SNAPSHOT', 'productionReady': false,
        'devices': [
          {'id': 'android-fixture', 'platform': 'android', 'available': true, 'state': 'IDLE'},
          {'id': 'ios-fixture', 'platform': 'ios', 'available': false, 'state': 'QUARANTINED'},
        ],
      }), 200);
    });
    addTearDown(client.close);
    await tester.pumpWidget(MaterialApp(home: TestLabHome(httpClient: client)));
    final refresh = find.text('Refresh inventory');
    await tester.tap(refresh);
    await tester.pumpAndSettle();
    expect(find.text('Available: 1'), findsOneWidget);
    expect(find.text('Quarantined: 1'), findsOneWidget);
    final filter = find.byType(DropdownButton<String>);
    await showControl(tester, filter);
    await tester.tap(filter);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Android').last);
    await tester.pumpAndSettle();
    expect(find.text('android-fixture'), findsOneWidget);
    expect(find.text('ios-fixture'), findsNothing);
    await tester.tap(filter);
    await tester.pumpAndSettle();
    await tester.tap(find.text('iOS').last);
    await tester.pumpAndSettle();
    expect(find.text('ios-fixture'), findsOneWidget);
    expect(find.text('android-fixture'), findsNothing);
    await tester.scrollUntilVisible(refresh, -180, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    await tester.tap(refresh);
    await tester.pumpAndSettle();
    expect(find.text('Inventory unavailable or unauthorized.'), findsOneWidget);
    expect(find.text('Available: 1'), findsNothing);
    expect(find.text('ios-fixture'), findsNothing);
    await tester.tap(refresh);
    await tester.pumpAndSettle();
    expect(attempts, 3);
    expect(find.text('Inventory unavailable or unauthorized.'), findsNothing);
    expect(find.text('Available: 1'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  for (final size in [const Size(390, 844), const Size(1280, 800)]) {
    testWidgets('saved report review and comparison at ${size.width}x${size.height}', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = size;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final requests = <String>[];
      final client = MockClient((request) async {
        expect(request.method, 'GET');
        requests.add(request.url.path);
        if (request.url.path == '/runs/$earlier') return http.Response(jsonEncode(reportFixture()), 200);
        if (request.url.path == '/runs/compare/$earlier/$later') return http.Response(jsonEncode(comparisonFixture()), 200);
        return http.Response('{}', 404);
      });
      addTearDown(client.close);
      await tester.pumpWidget(MaterialApp(home: TestLabHome(httpClient: client)));
      await fill(tester, 'Report ID', earlier);
      final retrieve = find.text('Retrieve saved report');
      await showControl(tester, retrieve);
      await tester.tap(retrieve);
      await tester.pumpAndSettle();
      await showControl(tester, find.text('Observed result: FAILED'));
      expect(find.text('Observed result: FAILED'), findsOneWidget);
      expect(find.text('Source revision: Unknown (mutable workspace)'), findsOneWidget);
      await fill(tester, 'Earlier report ID', earlier);
      await fill(tester, 'Later report ID', later);
      final compare = find.text('Compare reports');
      await showControl(tester, compare);
      await tester.tap(compare);
      await tester.pumpAndSettle();
      await showControl(tester, find.text('Later result: PASSED'));
      expect(find.text('Earlier result: FAILED'), findsOneWidget);
      expect(find.text('Later result: PASSED'), findsOneWidget);
      expect(requests, ['/runs/$earlier', '/runs/compare/$earlier/$later']);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('saved report retrieval can recover from an unavailable response', (tester) async {
    var attempts = 0;
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/runs/$earlier');
      attempts++;
      return attempts == 1 ? http.Response('{}', 503) : http.Response(jsonEncode(reportFixture()), 200);
    });
    addTearDown(client.close);
    await tester.pumpWidget(MaterialApp(home: TestLabHome(httpClient: client)));
    await fill(tester, 'Report ID', earlier);
    final retrieve = find.text('Retrieve saved report');
    await showControl(tester, retrieve);
    await tester.tap(retrieve);
    await tester.pumpAndSettle();
    await showControl(tester, find.text('Saved report unavailable or invalid.'));
    expect(find.text('Saved report unavailable or invalid.'), findsOneWidget);
    expect(find.text('Observed result: FAILED'), findsNothing);
    await tester.ensureVisible(retrieve);
    await tester.tap(retrieve);
    await tester.pumpAndSettle();
    await showControl(tester, find.text('Observed result: FAILED'));
    expect(find.text('Observed result: FAILED'), findsOneWidget);
    expect(find.text('Saved report unavailable or invalid.'), findsNothing);
    expect(attempts, 2);
    expect(tester.takeException(), isNull);
  });
}
