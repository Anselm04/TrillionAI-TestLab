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
  testWidgets('dashboard renders core controls', (tester) async {
    await tester.pumpWidget(const TestLabApp());
    expect(find.text('Phone farm'), findsOneWidget);
    expect(find.text('Refresh inventory'), findsOneWidget);
  });
}
