import 'package:flutter_test/flutter_test.dart';
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
}
