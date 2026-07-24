// Placeholder file so Tabs can register the center "+" as a Tab.Screen. This
// route is never actually shown — the tabBarButton intercepts the press and
// navigates to /create instead. Keeping this stub prevents Expo Router from
// complaining about a missing screen file.
import { Redirect } from 'expo-router';
export default function CreateTabStub() {
  return <Redirect href="/create" />;
}
