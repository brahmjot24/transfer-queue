rules_version = '2';
// Transfer Queue security rules.
// Paste this whole file into Firebase console → Firestore Database → Rules, then click Publish.
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null && request.auth.token.email != null; }
    function accessPath() { return /databases/$(database)/documents/access/$(request.auth.token.email); }
    function isMember() { return signedIn() && exists(accessPath()); }
    function myRole() { return get(accessPath()).data.role; }
    function isAdmin() { return isMember() && myRole() == 'admin'; }
    function canOperate() { return isMember() && myRole() in ['admin', 'manager', 'caller']; }
    // Only true during first-time setup, before the admin account exists.
    function booting() { return signedIn() && !exists(/databases/$(database)/documents/config/bootstrap); }

    // One entry per person: name, role, sign-in ID. Looked up by name at sign-in; never listed publicly.
    match /directory/{slug} {
      allow get: if true;          // look up one name at sign-in
      allow list: if isAdmin();    // only the admin can see the whole team
      allow create, delete: if isAdmin() || booting();
      allow update: if isAdmin() || booting()
        || (signedIn() && request.auth.token.email == resource.data.email
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['pinSet']));
    }

    // Who is allowed in, and their role. Only the admin manages this.
    match /access/{email} {
      allow read: if signedIn() && (request.auth.token.email == email || isAdmin());
      allow write: if isAdmin() || booting();
    }

    match /config/bootstrap {
      allow read: if true;
      allow write: if booting();
    }

    // Live board: everyone signed in can see it; calling agents, managers + admin can change it.
    match /meta/{d} {
      allow read: if isMember();
      allow write: if canOperate() || booting();
    }
    match /lists/{c} {
      allow read: if isMember();
      allow write: if canOperate() || booting();
    }
    match /logs/{d} {
      allow read: if isMember();
      allow write: if canOperate();
    }

    // The managing director's own activity: only the admin can read or write it.
    match /adminLogs/{d} {
      allow read, write: if isAdmin();
    }
  }
}
