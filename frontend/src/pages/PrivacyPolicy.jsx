export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 680, margin: '60px auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>Politique de confidentialité</h1>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 32 }}>ShoottimeTri — Application de tri et publication de photos</p>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Objet de l'application</h2>
      <p style={{ marginBottom: 24 }}>
        ShoottimeTri est une application développée à des fins d'intégration backend interne exclusive.
        Elle permet à un administrateur de trier des lots de photos et de les publier sur une Page Facebook via l'API Graph de Meta.
      </p>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Données collectées</h2>
      <p style={{ marginBottom: 24 }}>
        Cette application ne collecte, ne stocke ni ne traite aucune donnée d'utilisateurs publics.
        Son accès est restreint à un administrateur unique authentifié par mot de passe.
        Les seules données manipulées sont les photos uploadées par cet administrateur.
      </p>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Utilisation de l'API Facebook</h2>
      <p style={{ marginBottom: 24 }}>
        L'application utilise l'API Graph de Meta uniquement pour publier des photos sur une Page Facebook
        contrôlée par l'administrateur. Aucune donnée de profil, d'amis ou d'autres utilisateurs n'est
        accédée, collectée ou transmise.
      </p>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Partage des données</h2>
      <p style={{ marginBottom: 24 }}>
        Aucune donnée n'est partagée avec des tiers. L'application fonctionne en environnement privé
        et n'est pas accessible au public.
      </p>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Contact</h2>
      <p style={{ marginBottom: 24 }}>
        Pour toute question relative à cette politique, contactez l'administrateur de l'application.
      </p>

      <p style={{ fontSize: 12, color: '#aaa', borderTop: '1px solid #eee', paddingTop: 16, marginTop: 32 }}>
        Dernière mise à jour : mai 2025
      </p>
    </div>
  );
}
