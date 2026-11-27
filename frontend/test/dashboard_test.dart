import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:trillionai_testlab/main.dart';

void main() {
  test('API origin restricts insecure remote URLs and credentials', () {
    expect(apiUri('http://127.0.0.1:8787', '/device-farm').path, '/device-farm');
    expect(() => apiUri('http://example.com', '/runs'), throwsFormatException);
    expect(() => apiUri('https://user:secret@example.com', '/runs'), throwsFormatException);
  });
  test('inventory counts only explicit availability and quarantine', () {
    final snapshot = FarmSnapshot.parse({
      'status': 'RACK_SNAPSHOT',
      'devices': [
        {'id': 'a', 'available': true, 'platform': 'android'},
        {'id': 'b', 'available': false, 'state': 'QUARANTINED', 'platform': 'ios'}
      ]
    });
    expect(snapshot.available, 1);
    expect(snapshot.quarantined, 1);
    expect(() => FarmSnapshot.parse({'status': 'x', 'devices': [{'id': 'a'}]}), throwsFormatException);
  });
  test('capability catalog cannot assert customer execution or readiness', () {
    final data = <String, dynamic>{
      'schemaVersion': 1,
      'scope': 'DECLARED_LOCAL_RUNNER',
      'productionReady': false,
      'domains': [
        {'id': 'functional', 'label': 'Functional', 'implementationStatus': 'PARTIAL', 'runStatus': 'NOT_EXECUTED'},
        {'id': 'data', 'label': 'Data', 'implementationStatus': 'NOT_IMPLEMENTED', 'runStatus': 'NOT_EXECUTED'},
      ],
    };
    expect(CapabilitySnapshot.parse(data).partial, 1);
    expect(() => CapabilitySnapshot.parse({...data, 'productionReady': true}), throwsFormatException);
    expect(() => CapabilitySnapshot.parse({...data, 'domains': [
      {'id': 'functional', 'label': 'Functional', 'implementationStatus': 'PARTIAL', 'runStatus': 'PASSED'}
    ]}), throwsFormatException);
  });
  test('stored reports bind the requested ID and preserve observed failure', () {
    const id = '00000000-0000-4000-8000-000000000001';
    final report = <String, dynamic>{
      'schemaVersion': 1,
      'id': id,
      'project': 'fixture',
      'status': 'FAILED',
      'observations': [{'status': 'FAILED'}],
      'productionReady': false,
      'sourceRevision': {'status': 'UNKNOWN'},
      'integrity': {'algorithm': 'sha256', 'assertion': 'checksum-only-not-signed', 'digest': 'a'.padLeft(64, 'a')},
    };
    expect(reportPath(id), '/runs/$id');
    final snapshot = RunReportSnapshot.parse(report, expectedId: id);
    expect(snapshot.status, 'FAILED');
    expect(snapshot.revisionLabel, 'Unknown (mutable workspace)');
    expect(() => RunReportSnapshot.parse(report, expectedId: '00000000-0000-4000-8000-000000000002'), throwsFormatException);
    expect(() => RunReportSnapshot.parse({...report, 'status': 'PASSED'}), throwsFormatException);
    expect(() => RunReportSnapshot.parse({...report, 'productionReady': true}), throwsFormatException);
    expect(() => RunReportSnapshot.parse({...report, 'integrity': null}), throwsFormatException);
    expect(() => reportPath('invalid-id'), throwsFormatException);
  });
  testWidgets('dashboard renders core controls', (tester) async {
    await tester.pumpWidget(const TestLabApp());
    expect(find.text('Phone farm'), findsOneWidget);
    expect(find.text('Refresh inventory'), findsOneWidget);
  });
  test('saved comparison retains both results and does not certify a repair', () {
    const before = '00000000-0000-4000-8000-000000000001';
    const after = '00000000-0000-4000-8000-000000000002';
    final data = <String, dynamic>{
      'schemaVersion': 1, 'project': 'fixture', 'profile': 'node-built-in-tests',
      'status': 'OBSERVATIONS_DIFFER',
      'before': {'id': before, 'status': 'FAILED', 'exitCode': 1, 'integrityDigest': 'a'.padLeft(64, 'a')},
      'after': {'id': after, 'status': 'PASSED', 'exitCode': 0, 'integrityDigest': 'b'.padLeft(64, 'b')},
      'revisionComparison': 'NOT_ESTABLISHED', 'environmentEquivalenceVerified': false,
      'productCertified': false, 'productionReady': false,
    };
    expect(comparisonPath(before, after), '/runs/compare/$before/$after');
    final comparison = ReportComparison.parse(data, beforeId: before, afterId: after);
    expect(comparison.beforeStatus, 'FAILED');
    expect(comparison.afterStatus, 'PASSED');
    expect(() => comparisonPath(before, before), throwsFormatException);
    expect(() => ReportComparison.parse(data, beforeId: after, afterId: before), throwsFormatException);
    expect(() => ReportComparison.parse({...data, 'productCertified': true}, beforeId: before, afterId: after), throwsFormatException);
    expect(() => ReportComparison.parse({...data, 'status': 'OBSERVATIONS_MATCH'}, beforeId: before, afterId: after), throwsFormatException);
  });
  Map<String, dynamic> qualificationFixture() => {
    'schemaVersion': 1, 'product': 'AppForge', 'version': 1,
    'scope': 'INITIAL_FUNCTIONAL_JOURNEY',
    'productionReady': false, 'deploymentAuthorized': false,
    'requirements': List.generate(19, (i) => {
      'id': 'AF-${(i + 1).toString().padLeft(3, '0')}',
      'title': 'Fixture requirement ${i + 1}', 'status': 'NOT_EXECUTED',
    }),
  };
  test('qualification view rejects omissions, duplicate IDs and executed claims', () {
    final data = qualificationFixture();
    expect(QualificationTemplate.parse(data).requirements.length, 19);
    final rows = data['requirements'] as List;
    expect(() => QualificationTemplate.parse({...data, 'requirements': rows.skip(1).toList()}), throwsFormatException);
    expect(() => QualificationTemplate.parse({...data, 'requirements': [rows.first, ...rows.take(18)]}), throwsFormatException);
    expect(() => QualificationTemplate.parse({...data, 'requirements': [
      {...(rows.first as Map<String, dynamic>), 'status': 'PASSED'}, ...rows.skip(1)
    ]}), throwsFormatException);
    expect(() => QualificationTemplate.parse({...data, 'deploymentAuthorized': true}), throwsFormatException);
  });
  testWidgets('operator can retrieve the planned AppForge checklist without executing tests', (tester) async {
    var requests = 0;
    final client = MockClient((request) async {
      requests++;
      expect(request.method, 'GET');
      expect(request.url.path, '/qualification/templates/appforge');
      return http.Response(jsonEncode(qualificationFixture()), 200);
    });
    await tester.pumpWidget(MaterialApp(home: TestLabHome(httpClient: client)));
    final button = find.text('View AppForge qualification scope');
    await tester.scrollUntilVisible(button, 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(requests, 1);
    await tester.scrollUntilVisible(find.text('Requirements planned: 19'), 100, scrollable: find.byType(Scrollable).first);
    expect(find.text('Requirements planned: 19'), findsOneWidget);
    expect(find.text('No AppForge tests executed by this view.'), findsOneWidget);
    client.close();
  });
}
