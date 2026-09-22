// Tasky mobile — demo para entrevista.
// 3 pantallas manejadas con estado simple (sin react-navigation, para ir rápido):
// login -> home -> form -> vuelve a home
//
// Antes de correr: reemplaza API_BASE_URL con la URL real de tu Cloud Run
// (algo como https://tasky-api-xxxxx-uc.a.run.app)

import { useState, useEffect, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";

const API_BASE_URL = "https://tasky-api-836283338022.us-central1.run.app";

export default function App() {
  const [screen, setScreen] = useState("login"); // login | home | form
  const [token, setToken] = useState(null);

  if (screen === "login") {
    return (
      <LoginScreen
        onLoggedIn={(t) => {
          setToken(t);
          setScreen("home");
        }}
      />
    );
  }
  if (screen === "form") {
    return (
      <FormScreen
        token={token}
        onDone={() => setScreen("home")}
        onCancel={() => setScreen("home")}
      />
    );
  }
  return <HomeScreen onNewTask={() => setScreen("form")} />;
}

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("demo@tasky.dev");
  const [password, setPassword] = useState("demo123");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error("Credenciales inválidas");
      const data = await res.json();
      onLoggedIn(data.token);
    } catch (err) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Tasky</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      {loading ? (
        <ActivityIndicator />
      ) : (
        <Button title="Ingresar" onPress={handleLogin} />
      )}
    </SafeAreaView>
  );
}

function HomeScreen({ onNewTask }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks`);
      const data = await res.json();
      setTasks(data);
    } catch (err) {
      Alert.alert("Error cargando tareas", err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Mis tareas</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <View style={styles.taskItem}>
              <Text style={styles.taskTitle}>{item.title}</Text>
              {!!item.description && (
                <Text style={styles.taskDesc}>{item.description}</Text>
              )}
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Todavía no hay tareas</Text>
          }
        />
      )}
      <View style={styles.buttonRow}>
        <Button title="Refrescar" onPress={loadTasks} />
        <View style={{ width: 12 }} />
        <Button title="+ Nueva tarea" onPress={onNewTask} />
      </View>
    </SafeAreaView>
  );
}

function FormScreen({ token, onDone, onCancel }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) {
      Alert.alert("Falta el título");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, description }),
      });
      if (!res.ok) throw new Error("No se pudo guardar la tarea");
      onDone();
    } catch (err) {
      Alert.alert("Error", err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Nueva tarea</Text>
      <TextInput
        style={styles.input}
        placeholder="Título"
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        style={styles.input}
        placeholder="Descripción"
        value={description}
        onChangeText={setDescription}
      />
      <View style={styles.buttonRow}>
        <Button title="Cancelar" onPress={onCancel} color="#999" />
        <View style={{ width: 12 }} />
        {saving ? (
          <ActivityIndicator />
        ) : (
          <Button title="Guardar" onPress={handleSave} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 20 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 16,
  },
  taskItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  taskTitle: { fontSize: 16, fontWeight: "600" },
  taskDesc: { fontSize: 14, color: "#666", marginTop: 2 },
  empty: { textAlign: "center", color: "#999", marginTop: 40 },
});
