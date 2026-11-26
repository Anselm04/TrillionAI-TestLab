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
  testWidgets('dashboard renders core controls', (tester) async {
    await tester.pumpWidget(const TestLabApp());
    expect(find.text('Phone farm'), findsOneWidget);
    expect(find.text('Refresh inventory'), findsOneWidget);
  });
}
