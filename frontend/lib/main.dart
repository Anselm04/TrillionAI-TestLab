import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

void main() => runApp(const TestLabApp());
class TestLabApp extends StatelessWidget {
  const TestLabApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'TrillionAI TestLab',
    theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
    home: const TestLabHome(),
  );
}
class TestLabHome extends StatefulWidget {
  const TestLabHome({super.key});
  @override
  State<TestLabHome> createState() => _TestLabHomeState();
}
class _TestLabHomeState extends State<TestLabHome> {
  final endpoint = TextEditingController(text: 'http://127.0.0.1:8787');
  final token = TextEditingController();
  final project = TextEditingController(text: 'node-sample');
  bool running = false;
  String result = 'No test runs yet';
  Future<void> runTests() async {
    if (running) return;
    setState(() { running = true; result = 'Executing tests...'; });
    try {
      final response = await http.post(
        Uri.parse('${endpoint.text.trim().replaceAll(RegExp(r'/$'), '')}/runs'),
        headers: {'Authorization': 'Bearer ${token.text.trim()}', 'Content-Type': 'application/json'},
        body: jsonEncode({'project': project.text.trim()}),
      ).timeout(const Duration(minutes: 3));
      if (mounted) setState(() => result = const JsonEncoder.withIndent('  ').convert(jsonDecode(response.body)));
    } catch (error) {
      if (mounted) setState(() => result = 'Request failed: $error');
    } finally {
      if (mounted) setState(() => running = false);
    }
  }
  @override
  void dispose() { endpoint.dispose(); token.dispose(); project.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('TrillionAI TestLab')),
    body: ListView(padding: const EdgeInsets.all(20), children: [
      const Text('Local-first testing prototype', style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
      const SizedBox(height: 12),
      TextField(controller: endpoint, decoration: const InputDecoration(labelText: 'Backend URL')),
      TextField(controller: token, obscureText: true, decoration: const InputDecoration(labelText: 'Local API token')),
      TextField(controller: project, decoration: const InputDecoration(labelText: 'Workspace project directory')),
      const SizedBox(height: 20),
      FilledButton.icon(onPressed: running ? null : runTests, icon: const Icon(Icons.science), label: const Text('Run Node.js test suite')),
      const SizedBox(height: 20),
      SelectableText(result),
      const SizedBox(height: 24),
      const Text('Does not certify production readiness or deploy applications.'),
    ]),
  );
}
